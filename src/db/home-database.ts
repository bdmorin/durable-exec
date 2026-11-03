// The one database facade for a Horcrux home. App `hx_*` code and pi-durable's `SqliteStorage` share it.
//
// Adapter choice (P0-02, see evidence/P0-02): reuse Chord's `NodeSqliteDatabase` over `node:sqlite`, which Bun
// implements. It already satisfies Chord's `SqliteDatabase` contract: explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK
// behind one serial queue, handles invalidated on settlement, AggregateError when rollback fails. It never touches
// Bun's synchronous `db.transaction()`. Keep that choice behind this module so swapping adapters stays local.

import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase } from "@earendil-works/chord/sqlite";
import { NodeSqliteDatabase } from "@earendil-works/chord/sqlite/node";

export type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/chord/sqlite";

/** The shared, serialized facade for one home file. */
export type HomeDatabase = SqliteDatabase;

export type HomeDatabaseOptions = {
  /** How long SQLite waits on a competing file lock before SQLITE_BUSY. Default 5,000 ms. */
  readonly busyTimeoutMs?: number;
  /** Journal mode. Default `WAL`. */
  readonly journalMode?: "WAL" | "DELETE" | "TRUNCATE";
  /** `PRAGMA synchronous`. Default `FULL`: a reported commit survives power loss, not just a process crash. */
  readonly synchronous?: "FULL" | "NORMAL";
  /** WAL auto-checkpoint threshold in pages; SQLite's default is 1,000. Only applied in WAL mode. */
  readonly walAutoCheckpointPages?: number;
  /**
   * Extra SQL run right after the file opens, before the journal mode is set. This is where an ownership mechanism
   * (P0-04) can inject e.g. `PRAGMA locking_mode = EXCLUSIVE`, which must precede WAL setup to take effect there.
   * Nothing here is set by default.
   */
  readonly initSql?: readonly string[];
};

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

/**
 * Open (creating if absent) the home file at `path` on exactly one `node:sqlite` connection, which stays open until
 * `close()`. Does not create parent directories. `close()` runs `PRAGMA wal_checkpoint(TRUNCATE)` and closes the
 * connection; `SqliteStorage.close()` calls it too, so close Pi storage last, or close only one of them.
 */
export async function openHomeDatabase(path: string, options: HomeDatabaseOptions = {}): Promise<HomeDatabase> {
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const journalMode = options.journalMode ?? "WAL";
  const synchronous = options.synchronous ?? "FULL";
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) throw new RangeError("busyTimeoutMs must be >= 0");

  const connection = new DatabaseSync(path, { timeout: busyTimeoutMs });
  const db = new NodeSqliteDatabase(connection);
  try {
    for (const sql of options.initSql ?? []) await db.exec(sql);
    const mode = await db.get<{ journal_mode: string }>(`PRAGMA journal_mode = ${journalMode}`);
    // `:memory:` databases report "memory"; a file that cannot switch reports its old mode instead of failing.
    if (path !== ":memory:" && mode?.journal_mode.toUpperCase() !== journalMode) {
      throw new Error(`SQLite refused journal_mode=${journalMode} (got ${mode?.journal_mode ?? "nothing"})`);
    }
    await db.exec(`PRAGMA synchronous = ${synchronous}`);
    await db.exec("PRAGMA foreign_keys = ON");
    if (journalMode === "WAL" && options.walAutoCheckpointPages !== undefined) {
      if (!Number.isSafeInteger(options.walAutoCheckpointPages) || options.walAutoCheckpointPages < 0) {
        throw new RangeError("walAutoCheckpointPages must be >= 0");
      }
      await db.exec(`PRAGMA wal_autocheckpoint = ${options.walAutoCheckpointPages}`);
    }
    return db;
  } catch (error) {
    try {
      await db.close();
    } catch {
      // Keep the configuration error.
    }
    throw error;
  }
}
