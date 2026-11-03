// Home identity, format compatibility and the migration runner (P1-01, DESIGN §3–4).
//
// Two entry points, used in this order by the owned-open lifecycle (P1-02):
//
//   acquireHomeOwnership(path) → checkHomeFile(path, …) → openHomeDatabase(path) → prepareHome(db, …) → …
//
// `checkHomeFile` must come before `openHomeDatabase`, because opening is itself a write for some files: the facade
// switches a rollback-journal database to WAL (rewriting header bytes 18–19) and writes a 4 KiB header into an empty
// file. `checkHomeFile` never writes: it reads the header with plain file I/O and, only for SQLite files, inspects
// the schema over a read-only (and, without a hot WAL, `immutable`) connection. `prepareHome` repeats the same
// classification on the open facade, again with reads only, and refuses before its first write.
//
// A home's format version is the id of the last migration applied to it (see ./migrations/index.ts). Opening a home
// that is already current writes nothing.

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { HomeDatabase, SqliteExecutor, SqliteValue } from "../db/home-database.ts";
import { HOME_FORMAT, HX_APPLICATION_ID } from "./migrations/0001-home-identity.ts";
import { MIGRATIONS, type Migration, type MigrationContext, validateMigrations } from "./migrations/index.ts";

export { HOME_FORMAT, HX_APPLICATION_ID };

export type HomeFormatErrorCode =
  | "missing" // no file at the path (and creation was not requested)
  | "not-a-file" // the path is a directory or other non-regular file
  | "not-sqlite" // the file is not an SQLite database at all
  | "not-a-home" // an SQLite database belonging to something else
  | "uninitialized" // an empty SQLite file (or Pi tables only) and creation was not requested
  | "newer-format" // a Horcrux home written by a newer application
  | "inconsistent"; // claims to be a Horcrux home but its identity or migration history does not add up

/** Refusal to open or prepare a home. Thrown before anything is written. */
export class HomeFormatError extends Error {
  constructor(
    readonly code: HomeFormatErrorCode,
    readonly homePath: string | undefined,
    message: string,
  ) {
    super(homePath === undefined ? message : `${message}: ${homePath}`);
    this.name = "HomeFormatError";
  }
}

/** A migration threw (or broke the `hx_` namespace rule) and its transaction was rolled back. */
export class HomeMigrationError extends Error {
  constructor(
    readonly migrationId: number,
    readonly migrationName: string,
    /** Format version the home was left at (the last migration that committed). */
    readonly formatVersion: number,
    options: { cause: unknown },
  ) {
    super(
      `home migration ${migrationId} (${migrationName}) failed and was rolled back; home left at format version ` +
        `${formatVersion}: ${options.cause instanceof Error ? options.cause.message : String(options.cause)}`,
      options,
    );
    this.name = "HomeMigrationError";
  }
}

export type AppliedMigration = {
  readonly id: number;
  readonly name: string;
  readonly appliedAt: string;
  readonly appVersion: string;
  readonly runtime: string;
};

export type HomeInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "not-a-file" }
  | { readonly kind: "not-sqlite" }
  | { readonly kind: "not-a-home"; readonly reason: string }
  | { readonly kind: "inconsistent"; readonly reason: string }
  /** Empty file/database, or one holding only Pi's `pi_*` tables. */
  | { readonly kind: "uninitialized"; readonly piTables: boolean }
  | {
      readonly kind: "home";
      /** `current`: nothing to do. `outdated`: migrations pending. `newer`: written by a newer application. */
      readonly status: "current" | "outdated" | "newer";
      readonly homeId: string;
      readonly formatVersion: number;
      /** Highest format version this application understands. */
      readonly supportedFormatVersion: number;
      readonly createdAppVersion: string;
      readonly applied: readonly AppliedMigration[];
    };

export type CheckOptions = {
  /** Whether the caller may initialize a missing, empty or uninitialized file (i.e. `init`). Default false. */
  readonly create?: boolean;
  /** Registry override for tests. Default: the shipped migrations. */
  readonly migrations?: readonly Migration[];
};

export type PrepareOptions = CheckOptions & {
  /** Horcrux application version, recorded with each migration and as the creating version. */
  readonly appVersion: string;
};

export type PreparedHome = {
  readonly homeId: string;
  readonly formatVersion: number;
  /** True when this call initialized the home (ran migration 1). */
  readonly created: boolean;
  /** Migrations applied by this call, in order. Empty when the home was already current. */
  readonly applied: readonly { readonly id: number; readonly name: string }[];
};

/**
 * Classify the file at `path` without writing anything: no SQLite companion files are created unless a hot WAL
 * already exists (a crashed owner), in which case SQLite may add `-shm` to read it. Never throws for a classifiable
 * file; I/O errors other than "missing" propagate.
 */
export async function inspectHomeFile(path: string, options: CheckOptions = {}): Promise<HomeInspection> {
  const migrations = options.migrations ?? MIGRATIONS;
  let size: number;
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return { kind: "not-a-file" };
    size = stats.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (size === 0) return { kind: "uninitialized", piTables: false };
  if (!hasSqliteMagic(path)) return { kind: "not-sqlite" };

  // Without a hot WAL the main file is complete, so `immutable=1` reads it with no locks and no -wal/-shm files.
  // With one, the WAL must be read; ownership (acquired first) guarantees no live writer either way.
  let hotWal = false;
  try {
    hotWal = statSync(`${path}-wal`).size > 0;
  } catch {
    // No WAL.
  }
  const url = pathToFileURL(resolve(path));
  if (!hotWal) url.searchParams.set("immutable", "1");
  const connection = new DatabaseSync(url, { readOnly: true });
  try {
    return await classify(readerOf(connection), migrations);
  } catch (error) {
    if (error instanceof Error && /file is not a database/i.test(error.message)) return { kind: "not-sqlite" };
    throw error;
  } finally {
    connection.close();
  }
}

/** `inspectHomeFile`, then throw the `HomeFormatError` for anything the caller may not open (or create). */
export async function checkHomeFile(path: string, options: CheckOptions = {}): Promise<HomeInspection> {
  const inspection = await inspectHomeFile(path, options);
  const refusal = refusalFor(inspection, options.create ?? false, path);
  if (refusal) throw refusal;
  return inspection;
}

/**
 * Bring an open home to the current format: verify identity and history (reads only, throwing `HomeFormatError`
 * before any write), then run each pending migration in its own facade transaction, recording it in
 * `hx_migrations` and `hx_meta.format_version`. A failing migration rolls back entirely and throws
 * `HomeMigrationError`; earlier migrations of the same call stay committed. Never touches `pi_*`.
 */
export async function prepareHome(db: HomeDatabase, options: PrepareOptions): Promise<PreparedHome> {
  const migrations = options.migrations ?? MIGRATIONS;
  validateMigrations(migrations);
  const state = await classify(db, migrations);
  const refusal = refusalFor(state, options.create ?? false, undefined);
  if (refusal) throw refusal;

  const from = state.kind === "home" ? state.formatVersion : 0;
  const sqliteVersion = (await db.get<{ v: string }>("SELECT sqlite_version() AS v"))?.v ?? "unknown";
  const applied: { id: number; name: string }[] = [];
  for (const migration of migrations.slice(from)) {
    const context: MigrationContext = {
      appVersion: options.appVersion,
      runtime: runtimeDescription(),
      sqliteVersion,
      now: new Date().toISOString(),
    };
    try {
      await db.transaction(async (tx) => {
        const current = await formatVersionOf(tx);
        if (current !== migration.id - 1) {
          throw new HomeFormatError(
            "inconsistent",
            undefined,
            `home is at format version ${current}, expected ${migration.id - 1} before migration ${migration.id}`,
          );
        }
        const before = await schemaObjects(tx);
        await migration.up(tx, context);
        assertOnlyHxChanged(before, await schemaObjects(tx));
        await tx.run(
          "INSERT INTO hx_migrations (id, name, applied_at, app_version, runtime) VALUES (?, ?, ?, ?, ?)",
          migration.id,
          migration.name,
          context.now,
          context.appVersion,
          context.runtime,
        );
        await tx.run(
          "INSERT INTO hx_meta (key, value) VALUES ('format_version', ?) " +
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          String(migration.id),
        );
      });
    } catch (cause) {
      if (cause instanceof HomeFormatError) throw cause;
      throw new HomeMigrationError(migration.id, migration.name, migration.id - 1, { cause });
    }
    applied.push({ id: migration.id, name: migration.name });
  }

  const homeId = await db.get<{ value: string }>("SELECT value FROM hx_meta WHERE key = 'home_id'");
  if (!homeId) throw new HomeFormatError("inconsistent", undefined, "home has no hx_meta.home_id");
  return { homeId: homeId.value, formatVersion: migrations.length, created: from === 0, applied };
}

function refusalFor(state: HomeInspection, create: boolean, path: string | undefined): HomeFormatError | undefined {
  switch (state.kind) {
    case "missing":
      return create ? undefined : new HomeFormatError("missing", path, "home does not exist");
    case "not-a-file":
      return new HomeFormatError("not-a-file", path, "home is not a regular file");
    case "not-sqlite":
      return new HomeFormatError("not-sqlite", path, "not a Horcrux home (not an SQLite database)");
    case "not-a-home":
      return new HomeFormatError("not-a-home", path, `not a Horcrux home (${state.reason})`);
    case "inconsistent":
      return new HomeFormatError("inconsistent", path, `damaged Horcrux home (${state.reason})`);
    case "uninitialized":
      return create
        ? undefined
        : new HomeFormatError("uninitialized", path, "not an initialized Horcrux home (use `init` to create one)");
    case "home":
      if (state.status !== "newer") return undefined;
      return new HomeFormatError(
        "newer-format",
        path,
        `home format version ${state.formatVersion} is newer than this application supports ` +
          `(${state.supportedFormatVersion}); upgrade Horcrux to open it`,
      );
  }
}

type Reader = Pick<SqliteExecutor, "get" | "all">;

/** Read-only classification shared by the pre-open file check and the facade. */
async function classify(db: Reader, migrations: readonly Migration[]): Promise<HomeInspection> {
  const applicationId = (await db.get<{ application_id: number }>("PRAGMA application_id"))?.application_id ?? 0;
  const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
    (row) => row.name,
  );
  if (applicationId !== 0 && applicationId !== HX_APPLICATION_ID) {
    return { kind: "not-a-home", reason: `SQLite application_id 0x${applicationId.toString(16)} is another application's` };
  }
  if (!tables.includes("hx_meta")) {
    if (applicationId === HX_APPLICATION_ID) return { kind: "inconsistent", reason: "hx_meta is missing" };
    const hx = tables.filter((name) => name.startsWith("hx_"));
    if (hx.length > 0) return { kind: "not-a-home", reason: `has ${hx.join(", ")} but no hx_meta` };
    const foreign = tables.filter((name) => !name.startsWith("pi_") && !name.startsWith("sqlite_"));
    if (foreign.length > 0) return { kind: "not-a-home", reason: `SQLite database with tables ${foreign.join(", ")}` };
    return { kind: "uninitialized", piTables: tables.some((name) => name.startsWith("pi_")) };
  }

  const meta = new Map(
    (await db.all<{ key: string; value: string }>("SELECT key, value FROM hx_meta")).map((row) => [row.key, row.value]),
  );
  if (meta.get("format") !== HOME_FORMAT) return { kind: "not-a-home", reason: "hx_meta.format is not a Horcrux home" };
  if (applicationId !== HX_APPLICATION_ID) return { kind: "inconsistent", reason: "SQLite application_id is not set" };
  const formatVersion = Number(meta.get("format_version"));
  if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
    return { kind: "inconsistent", reason: `hx_meta.format_version is ${JSON.stringify(meta.get("format_version"))}` };
  }
  const applied = tables.includes("hx_migrations")
    ? (
        await db.all<{ id: number; name: string; applied_at: string; app_version: string; runtime: string }>(
          "SELECT id, name, applied_at, app_version, runtime FROM hx_migrations ORDER BY id",
        )
      ).map((row) => ({
        id: row.id,
        name: row.name,
        appliedAt: row.applied_at,
        appVersion: row.app_version,
        runtime: row.runtime,
      }))
    : [];
  const home = {
    kind: "home" as const,
    homeId: meta.get("home_id") ?? "",
    formatVersion,
    supportedFormatVersion: migrations.length,
    createdAppVersion: meta.get("created_app_version") ?? "",
    applied,
  };
  // Newer homes are judged only by the frozen fields: their later history means nothing to this application.
  if (formatVersion > migrations.length) return { ...home, status: "newer" };
  if (home.homeId === "") return { kind: "inconsistent", reason: "hx_meta.home_id is missing" };
  if (applied.length !== formatVersion) {
    return {
      kind: "inconsistent",
      reason: `format version ${formatVersion} but ${applied.length} recorded migrations`,
    };
  }
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index]!;
    if (row.id !== expected.id || row.name !== expected.name) {
      return {
        kind: "inconsistent",
        reason: `recorded migration ${row.id} (${row.name}) is not this application's migration ${expected.id} (${expected.name})`,
      };
    }
  }
  return { ...home, status: formatVersion === migrations.length ? "current" : "outdated" };
}

async function formatVersionOf(tx: SqliteExecutor): Promise<number> {
  const table = await tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'hx_meta'");
  if (!table) return 0;
  const row = await tx.get<{ value: string }>("SELECT value FROM hx_meta WHERE key = 'format_version'");
  return row ? Number(row.value) : 0;
}

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string | null };

async function schemaObjects(tx: SqliteExecutor): Promise<Map<string, SchemaObject>> {
  const rows = await tx.all<SchemaObject>("SELECT type, name, tbl_name, sql FROM sqlite_master");
  return new Map(rows.map((row) => [`${row.type}:${row.name}`, row]));
}

/** A migration may create, alter or drop only objects on `hx_*` tables. Throwing here rolls it back. */
function assertOnlyHxChanged(before: Map<string, SchemaObject>, after: Map<string, SchemaObject>): void {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key);
    const b = after.get(key);
    if (a && b && a.sql === b.sql && a.tbl_name === b.tbl_name) continue;
    const table = (b ?? a)!.tbl_name;
    if (!table.startsWith("hx_") || (a && !a.tbl_name.startsWith("hx_"))) {
      throw new Error(`migrations may only change hx_ objects, but ${key} (table ${table}) changed`);
    }
  }
}

function hasSqliteMagic(path: string): boolean {
  const magic = Buffer.from("SQLite format 3\0", "latin1");
  const header = Buffer.alloc(magic.length);
  const fd = openSync(path, "r");
  try {
    return readSync(fd, header, 0, header.length, 0) === header.length && header.equals(magic);
  } finally {
    closeSync(fd);
  }
}

function readerOf(connection: DatabaseSync): Reader {
  return {
    async get<T extends object>(sql: string, ...params: SqliteValue[]) {
      return connection.prepare(sql).get(...params) as T | undefined;
    },
    async all<T extends object>(sql: string, ...params: SqliteValue[]) {
      return connection.prepare(sql).all(...params) as T[];
    },
  };
}

function runtimeDescription(): string {
  const engine = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  return `${engine} ${process.platform}-${process.arch}`;
}
