import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import type { EntryId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { commitWrites } from "@earendil-works/pi-durable/testing";
import { type HomeDatabase, openHomeDatabase } from "../db/home-database.ts";
import { MIGRATIONS, type Migration } from "./migrations/index.ts";
import {
  checkHomeFile,
  HomeFormatError,
  HomeMigrationError,
  HX_APPLICATION_ID,
  inspectHomeFile,
  prepareHome,
} from "./schema.ts";

const ctx = BACKGROUND_CONTEXT;
const APP = "9.9.9-test";
let dir: string;
let path: string;
let open: HomeDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hx-p1-01-"));
  path = join(dir, "home.horcrux");
  open = [];
});

afterEach(async () => {
  for (const db of open) await db.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

async function openDb(): Promise<HomeDatabase> {
  const db = await openHomeDatabase(path);
  open.push(db);
  return db;
}

async function closeDb(db: HomeDatabase): Promise<void> {
  open = open.filter((d) => d !== db);
  await db.close();
}

async function createHome(migrations: readonly Migration[] = MIGRATIONS): Promise<string> {
  const db = await openDb();
  const { homeId } = await prepareHome(db, { create: true, appVersion: APP, migrations });
  await closeDb(db);
  return homeId;
}

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const files = () => readdirSync(dir).sort();
const tables = async (db: HomeDatabase) =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);
const changes = async (db: HomeDatabase) => (await db.get<{ n: number }>("SELECT total_changes() AS n"))!.n;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

function migration(id: number, name: string, up: Migration["up"]): Migration {
  return { id, name, up };
}

const m1 = MIGRATIONS[0]!;
const addTwo = migration(2, "add-two", async (tx) => {
  await tx.exec("CREATE TABLE hx_two (label TEXT NOT NULL)");
  await tx.run("INSERT INTO hx_two (label) VALUES ('two')");
});
const failingThree = migration(3, "add-three", async (tx) => {
  await tx.exec("CREATE TABLE hx_three (x INTEGER)");
  await tx.run("INSERT INTO hx_two (label) VALUES ('three')");
  throw new Error("deliberate failure in migration 3");
});

describe("fresh home identity", () => {
  test("init records a stable home id, format version, creating app and runtime; reopening keeps them", async () => {
    const db = await openDb();
    const prepared = await prepareHome(db, { create: true, appVersion: APP });
    expect(prepared.created).toBe(true);
    expect(prepared.formatVersion).toBe(MIGRATIONS.length);
    expect(prepared.applied).toEqual(MIGRATIONS.map(({ id, name }) => ({ id, name })));
    expect(prepared.homeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const meta = Object.fromEntries(
      (await db.all<{ key: string; value: string }>("SELECT key, value FROM hx_meta")).map((r) => [r.key, r.value]),
    );
    expect(meta).toMatchObject({
      format: "horcrux-home",
      home_id: prepared.homeId,
      format_version: String(MIGRATIONS.length),
      created_app_version: APP,
      created_runtime: `bun ${Bun.version} ${process.platform}-${process.arch}`,
    });
    expect(meta.created_sqlite_version).toMatch(/^3\.\d+\.\d+$/);
    expect(await db.get("PRAGMA application_id")).toEqual({ application_id: HX_APPLICATION_ID });
    expect(await db.all("SELECT id, name, app_version FROM hx_migrations ORDER BY id")).toEqual(
      MIGRATIONS.map(({ id, name }) => ({ id, name, app_version: APP })),
    );
    await closeDb(db);

    // A later app version reopens it: same identity, nothing applied, creating version untouched.
    const before = sha(path);
    const again = await openDb();
    const reopened = await prepareHome(again, { appVersion: "10.0.0" });
    expect(reopened).toEqual({ homeId: prepared.homeId, formatVersion: MIGRATIONS.length, created: false, applied: [] });
    expect(await changes(again)).toBe(0);
    expect(await again.get("SELECT value FROM hx_meta WHERE key = 'created_app_version'")).toEqual({ value: APP });
    await closeDb(again);
    expect(sha(path)).toBe(before);
  });

  test("without create, an empty file is refused as uninitialized and left empty", async () => {
    writeFileSync(path, "");
    const error = await rejection(checkHomeFile(path));
    expect(error).toBeInstanceOf(HomeFormatError);
    expect((error as HomeFormatError).code).toBe("uninitialized");
    expect(statSync(path).size).toBe(0);
    expect(files()).toEqual(["home.horcrux"]);
    // With create it is acceptable, as is a missing path.
    expect(await checkHomeFile(path, { create: true })).toEqual({ kind: "uninitialized", piTables: false });
    expect(await checkHomeFile(join(dir, "absent"), { create: true })).toEqual({ kind: "missing" });
    expect(((await rejection(checkHomeFile(join(dir, "absent")))) as HomeFormatError).code).toBe("missing");
  });
});

describe("migrations", () => {
  test("pending migrations run in order, each committed on its own; a failure rolls back only itself", async () => {
    await createHome([m1]);
    const db = await openDb();

    const error = await rejection(prepareHome(db, { appVersion: APP, migrations: [m1, addTwo, failingThree] }));
    expect(error).toBeInstanceOf(HomeMigrationError);
    expect(error).toMatchObject({ migrationId: 3, migrationName: "add-three", formatVersion: 2 });
    expect(((error as Error).cause as Error).message).toBe("deliberate failure in migration 3");

    // Migration 2 committed; nothing of migration 3 survived: no table, no row, no history, no version bump.
    expect(await tables(db)).not.toContain("hx_three");
    expect(await db.all("SELECT label FROM hx_two")).toEqual([{ label: "two" }]);
    expect(await db.all("SELECT id, name FROM hx_migrations ORDER BY id")).toEqual([
      { id: 1, name: "home-identity" },
      { id: 2, name: "add-two" },
    ]);
    expect(await db.get("SELECT value FROM hx_meta WHERE key = 'format_version'")).toEqual({ value: "2" });
    await closeDb(db);

    const fixedThree = migration(3, "add-three", async (tx) => {
      await tx.exec("CREATE TABLE hx_three (x INTEGER)");
    });
    expect(await inspectHomeFile(path, { migrations: [m1, addTwo, fixedThree] })).toMatchObject({
      kind: "home",
      status: "outdated",
      formatVersion: 2,
    });
    const again = await openDb();
    const prepared = await prepareHome(again, { appVersion: APP, migrations: [m1, addTwo, fixedThree] });
    expect(prepared).toMatchObject({ formatVersion: 3, created: false, applied: [{ id: 3, name: "add-three" }] });
  });

  test("a failing first migration leaves the file uninitialized, and init can then succeed", async () => {
    const brokenOne = migration(1, m1.name, async (tx, context) => {
      await m1.up(tx, context);
      throw new Error("deliberate failure in migration 1");
    });
    const db = await openDb();
    const error = await rejection(prepareHome(db, { create: true, appVersion: APP, migrations: [brokenOne] }));
    expect(error).toMatchObject({ name: "HomeMigrationError", migrationId: 1, formatVersion: 0 });
    expect(await tables(db)).toEqual([]);
    // The application_id header write rolled back with the rest.
    expect(await db.get("PRAGMA application_id")).toEqual({ application_id: 0 });

    const prepared = await prepareHome(db, { create: true, appVersion: APP });
    expect(prepared.formatVersion).toBe(MIGRATIONS.length);
  });

  test("a migration that touches anything outside hx_ is rolled back", async () => {
    await createHome([m1]);
    const db = await openDb();
    const sneaky = migration(2, "sneaky", async (tx) => {
      await tx.exec("CREATE TABLE hx_ok (x INTEGER); CREATE TABLE pi_sneaky (x INTEGER)");
    });
    const error = await rejection(prepareHome(db, { appVersion: APP, migrations: [m1, sneaky] }));
    expect(error).toBeInstanceOf(HomeMigrationError);
    expect(((error as Error).cause as Error).message).toContain("table:pi_sneaky");
    expect(await tables(db)).toEqual(["hx_meta", "hx_migrations"]);
  });

  test("a non-contiguous registry is rejected before anything runs", async () => {
    const db = await openDb();
    const gap = migration(3, "gap", async () => {});
    await expect(prepareHome(db, { create: true, appVersion: APP, migrations: [m1, gap] })).rejects.toThrow(
      "contiguous",
    );
    expect(await tables(db)).toEqual([]);
  });

  test("history from a different migration 2 (e.g. an unmerged branch) is refused as inconsistent", async () => {
    await createHome([m1, migration(2, "alpha", async (tx) => tx.exec("CREATE TABLE hx_alpha (x INTEGER)"))]);
    const beta = migration(2, "beta", async (tx) => tx.exec("CREATE TABLE hx_beta (x INTEGER)"));
    const error = await rejection(checkHomeFile(path, { migrations: [m1, beta] }));
    expect(error).toMatchObject({ name: "HomeFormatError", code: "inconsistent" });
    expect((error as Error).message).toContain("migration 2 (alpha)");
  });
});

describe("refusals write nothing", () => {
  // Proof of "no write": the main file's SHA-256 is identical afterwards, no -wal/-shm/-journal companion is left,
  // and on the facade path the connection's total_changes() is still 0 when prepareHome refuses.

  test("a newer home is refused with a typed error by the file check and by prepareHome", async () => {
    const future = migration(2, "from-the-future", async (tx) => tx.exec("CREATE TABLE hx_future (x INTEGER)"));
    const homeId = await createHome([m1, future]);
    const before = sha(path);
    expect(files()).toEqual(["home.horcrux"]);

    const inspection = await inspectHomeFile(path, { migrations: [m1] });
    expect(inspection).toMatchObject({ kind: "home", status: "newer", homeId, formatVersion: 2, supportedFormatVersion: 1 });
    const error = await rejection(checkHomeFile(path, { migrations: [m1] }));
    expect(error).toBeInstanceOf(HomeFormatError);
    expect(error).toMatchObject({ code: "newer-format", homePath: path });
    expect((error as Error).message).toContain("format version 2 is newer than this application supports (1)");
    expect(sha(path)).toBe(before);
    expect(files()).toEqual(["home.horcrux"]);

    // The facade path refuses before its first write too (opening a WAL home only adds companions that close removes).
    const db = await openDb();
    const refused = await rejection(prepareHome(db, { appVersion: APP, migrations: [m1] }));
    expect(refused).toMatchObject({ name: "HomeFormatError", code: "newer-format" });
    expect(await changes(db)).toBe(0);
    await closeDb(db);
    expect(sha(path)).toBe(before);
    expect(files()).toEqual(["home.horcrux"]);
  });

  test("the file check reads a hot WAL (crashed owner) instead of the stale main file", async () => {
    const future = migration(2, "from-the-future", async (tx) => tx.exec("CREATE TABLE hx_future (x INTEGER)"));
    const db = await openDb(); // left open: every committed page is still only in home.horcrux-wal
    await prepareHome(db, { create: true, appVersion: APP, migrations: [m1, future] });
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    expect(await inspectHomeFile(path, { migrations: [m1] })).toMatchObject({ kind: "home", status: "newer" });
  });

  test("files that are not Horcrux homes are told apart and left untouched", async () => {
    const cases: { name: string; make: (file: string) => void; code: string }[] = [
      { name: "text.txt", make: (f) => writeFileSync(f, "just some text, not a database\n".repeat(20)), code: "not-sqlite" },
      { name: "short.bin", make: (f) => writeFileSync(f, "SQLite"), code: "not-sqlite" },
      {
        name: "bad-sqlite.db",
        make: (f) => writeFileSync(f, Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(200, 7)])),
        code: "not-sqlite",
      },
      {
        name: "foreign.db",
        make: (f) => sqlite(f, "CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hello')"),
        code: "not-a-home",
      },
      { name: "other-app.db", make: (f) => sqlite(f, "PRAGMA application_id = 1234"), code: "not-a-home" },
      // A P0-03 probe home: the stub's hx_files table but no hx_meta.
      { name: "p0-03-stub.horcrux", make: (f) => sqlite(f, "CREATE TABLE hx_files (path TEXT)"), code: "not-a-home" },
    ];
    for (const { name, make, code } of cases) {
      const file = join(dir, name);
      make(file);
      const before = sha(file);
      const error = await rejection(checkHomeFile(file, { create: true }));
      expect({ name, error }).toMatchObject({ name, error: { name: "HomeFormatError", code } });
      expect(sha(file)).toBe(before);
    }
    mkdirSync(join(dir, "a-directory"));
    expect(await rejection(checkHomeFile(join(dir, "a-directory")))).toMatchObject({ code: "not-a-file" });
    expect(files()).toEqual([
      "a-directory",
      "bad-sqlite.db",
      "foreign.db",
      "other-app.db",
      "p0-03-stub.horcrux",
      "short.bin",
      "text.txt",
    ]);
  });

  test("prepareHome on an open foreign database refuses with no changes", async () => {
    const db = await openDb();
    await db.exec("CREATE TABLE notes (body TEXT)");
    const error = await rejection(prepareHome(db, { create: true, appVersion: APP }));
    expect(error).toMatchObject({ name: "HomeFormatError", code: "not-a-home" });
    expect(await tables(db)).toEqual(["notes"]);
    expect(await db.get("PRAGMA application_id")).toEqual({ application_id: 0 });
  });
});

function sqlite(file: string, sql: string): void {
  const connection = new DatabaseSync(file);
  connection.exec(sql);
  connection.close();
}

describe("coexistence with pi-durable SqliteStorage on one file", () => {
  async function piEntry(storage: SqliteStorage, label: string): Promise<EntryId> {
    const id = await storage.mintId<EntryId>();
    await commitWrites(storage, [{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "hx.test", data: { label } } }], ctx);
    return id;
  }

  const piSchema = async (db: HomeDatabase) =>
    db.all("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'pi\\_%' ESCAPE '\\' ORDER BY name");

  test("home first, then Pi; reopened with Pi first, then the home check", async () => {
    const db = await openDb();
    const { homeId } = await prepareHome(db, { create: true, appVersion: APP });
    const storage = await SqliteStorage.open(db, { prefix: "pi_" });
    await commitWrites(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], ctx);
    const entry = await piEntry(storage, "first");
    open = [];
    await storage.close(ctx); // closes the shared facade

    const again = await openDb();
    const storage2 = await SqliteStorage.open(again, { prefix: "pi_" });
    const pi = await piSchema(again);
    expect(await prepareHome(again, { appVersion: APP })).toMatchObject({ homeId, applied: [] });
    expect((await storage2.entry(entry, ctx))?.entry.data).toEqual({ label: "first" });
    const names = await tables(again);
    expect(names.filter((n) => !n.startsWith("pi_"))).toEqual(["hx_meta", "hx_migrations"]);
    expect(names.some((n) => n.startsWith("pi_"))).toBe(true);
    expect(await piSchema(again)).toEqual(pi);
    open = [];
    await storage2.close(ctx);
  });

  test("Pi first on a fresh file, then init: Pi's tables and rows are untouched", async () => {
    const db = await openDb();
    const storage = await SqliteStorage.open(db, { prefix: "pi_" });
    await commitWrites(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], ctx);
    const entry = await piEntry(storage, "before-init");
    const pi = await piSchema(db);

    expect(((await rejection(prepareHome(db, { appVersion: APP }))) as HomeFormatError).code).toBe("uninitialized");
    const prepared = await prepareHome(db, { create: true, appVersion: APP });
    expect(prepared.created).toBe(true);
    expect(await piSchema(db)).toEqual(pi);
    expect((await storage.entry(entry, ctx))?.entry.data).toEqual({ label: "before-init" });
    await piEntry(storage, "after-init");
    open = [];
    await storage.close(ctx);

    expect(await inspectHomeFile(path)).toMatchObject({ kind: "home", status: "current", homeId: prepared.homeId });
  });
});
