import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import type { EntryId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { commitWrites } from "@earendil-works/pi-durable/testing";
import { type HomeDatabase, openHomeDatabase, type SqliteExecutor } from "./home-database.ts";

const ctx = BACKGROUND_CONTEXT;
let dir: string;
let path: string;
let open: HomeDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hx-p0-02-"));
  path = join(dir, "home.horcrux");
  open = [];
});

afterEach(async () => {
  for (const db of open) await db.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

async function home(options?: Parameters<typeof openHomeDatabase>[1]): Promise<HomeDatabase> {
  const db = await openHomeDatabase(path, options);
  open.push(db);
  await db.exec("CREATE TABLE IF NOT EXISTS hx_log (seq INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  return db;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function labels(db: SqliteExecutor): Promise<string[]> {
  return (await db.all<{ label: string }>("SELECT label FROM hx_log ORDER BY seq")).map((row) => row.label);
}

describe("openHomeDatabase settings", () => {
  test("defaults: WAL, synchronous FULL, 5 s busy timeout, one connection", async () => {
    const db = await home();
    expect(await db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
    expect(await db.get("PRAGMA synchronous")).toEqual({ synchronous: 2 });
    expect(await db.get("PRAGMA busy_timeout")).toEqual({ timeout: 5000 });
    expect(await db.get("PRAGMA locking_mode")).toEqual({ locking_mode: "normal" });
    expect(await db.all("PRAGMA database_list")).toHaveLength(1);
  });

  test("options are injectable, initSql runs before journal setup", async () => {
    const db = await home({
      busyTimeoutMs: 250,
      synchronous: "NORMAL",
      walAutoCheckpointPages: 0,
      initSql: ["PRAGMA locking_mode = EXCLUSIVE"],
    });
    expect(await db.get("PRAGMA busy_timeout")).toEqual({ timeout: 250 });
    expect(await db.get("PRAGMA synchronous")).toEqual({ synchronous: 1 });
    expect(await db.get("PRAGMA wal_autocheckpoint")).toEqual({ wal_autocheckpoint: 0 });
    expect(await db.get("PRAGMA locking_mode")).toEqual({ locking_mode: "exclusive" });
    expect(await db.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
  });

  test("state survives close and reopen of the file", async () => {
    const db = await home();
    await db.run("INSERT INTO hx_log (label) VALUES (?)", "persisted");
    await db.close();
    const again = await home();
    expect(await labels(again)).toEqual(["persisted"]);
  });
});

describe("transactions", () => {
  test("an error thrown after an await rolls back every write and rejects with that same error", async () => {
    const db = await home();
    await db.run("INSERT INTO hx_log (label) VALUES (?)", "before");
    const boom = new Error("boom after await");
    const outcome = db.transaction(async (tx) => {
      await tx.run("INSERT INTO hx_log (label) VALUES (?)", "tx-1");
      await tick();
      await tx.run("INSERT INTO hx_log (label) VALUES (?)", "tx-2");
      await tick();
      expect(await labels(tx)).toEqual(["before", "tx-1", "tx-2"]);
      throw boom;
    });
    await expect(outcome).rejects.toBe(boom);
    expect(await labels(db)).toEqual(["before"]);

    // Proof from disk, not only from this connection: a fresh connection sees no tx rows.
    await db.close();
    expect(await labels(await home())).toEqual(["before"]);
  });

  test("a handle used after the callback settles fails loudly (commit and rollback)", async () => {
    const db = await home();
    let committed: SqliteExecutor | undefined;
    await db.transaction(async (tx) => {
      committed = tx;
    });
    await expect(committed!.run("INSERT INTO hx_log (label) VALUES (?)", "late")).rejects.toThrow(
      "no longer active",
    );
    await expect(committed!.all("SELECT * FROM hx_log")).rejects.toThrow("no longer active");

    let rolledBack: SqliteExecutor | undefined;
    await db
      .transaction(async (tx) => {
        rolledBack = tx;
        throw new Error("abort");
      })
      .catch(() => {});
    await expect(rolledBack!.exec("DELETE FROM hx_log")).rejects.toThrow("no longer active");
    expect(await labels(db)).toEqual([]);
  });

  test("a handle leaked from a callback cannot write after commit, even when the callback did not await it", async () => {
    const db = await home();
    let late: Promise<void> | undefined;
    await db.transaction(async (tx) => {
      late = tick().then(() => tx.run("INSERT INTO hx_log (label) VALUES (?)", "escaped"));
    });
    await expect(late!).rejects.toThrow("no longer active");
    expect(await labels(db)).toEqual([]);
  });

  test("an unrelated db.run issued while a transaction is open waits and stays out of it", async () => {
    const db = await home();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let txOpen!: () => void;
    const opened = new Promise<void>((resolve) => (txOpen = resolve));

    const tx = db.transaction(async (handle) => {
      await handle.run("INSERT INTO hx_log (label) VALUES (?)", "tx-row");
      txOpen();
      await gate; // transaction held open across an await
      // The outside run has been issued but must not have executed inside this transaction.
      expect(await labels(handle)).toEqual(["tx-row"]);
      events.push("tx-throws");
      throw new Error("rollback");
    });
    await opened;
    const outside = db.run("INSERT INTO hx_log (label) VALUES (?)", "outside").then(() => events.push("outside-done"));
    const outsideRead = db.all<{ label: string }>("SELECT label FROM hx_log ORDER BY seq");
    await tick();
    await tick();
    expect(events).toEqual([]); // still queued
    release();

    await expect(tx).rejects.toThrow("rollback");
    await outside;
    expect(events).toEqual(["tx-throws", "outside-done"]);
    // The outside write survived the rollback (so it did not run inside the tx) and the read queued after it saw
    // neither the rolled-back row nor a missing outside row.
    expect(await outsideRead).toEqual([{ label: "outside" }]);
    expect(await labels(db)).toEqual(["outside"]);
  });

  test("a second transaction queues behind the first", async () => {
    const db = await home();
    const order: string[] = [];
    const first = db.transaction(async (tx) => {
      order.push("first-start");
      await tick();
      await tx.run("INSERT INTO hx_log (label) VALUES (?)", "first");
      await tick();
      order.push("first-end");
    });
    const second = db.transaction(async (tx) => {
      order.push("second-start");
      expect(await labels(tx)).toEqual(["first"]);
      await tx.run("INSERT INTO hx_log (label) VALUES (?)", "second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    expect(await labels(db)).toEqual(["first", "second"]);
  });

  test("a failed COMMIT is reported, not swallowed", async () => {
    const db = await home();
    await db.exec("PRAGMA foreign_keys = ON");
    await db.exec("CREATE TABLE hx_parent (id INTEGER PRIMARY KEY)");
    await db.exec(
      "CREATE TABLE hx_child (id INTEGER PRIMARY KEY, parent INTEGER REFERENCES hx_parent(id) DEFERRABLE INITIALLY DEFERRED)",
    );
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO hx_child (parent) VALUES (?)", 42);
      }),
    ).rejects.toThrow();
    // The connection is usable afterwards and the dangling row is gone.
    expect(await db.all("SELECT * FROM hx_child")).toEqual([]);
    await db.run("INSERT INTO hx_log (label) VALUES (?)", "after");
    expect(await labels(db)).toEqual(["after"]);
  });
});

describe("shared with pi-durable SqliteStorage", () => {
  test("interleaved hx_ writes and Pi commits on one facade stay serialized and in issue order", async () => {
    const db = await home();
    const storage = await SqliteStorage.open(db, { prefix: "pi_" });
    await commitWrites(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], ctx);

    const done: string[] = [];
    const piEntry = async (label: string) => {
      const id = await storage.mintId<EntryId>();
      const seq = await commitWrites(
        storage,
        [{ type: "entry", value: { id, conversationId: ROOT_CONVERSATION_ID, kind: "hx.test", data: { label } } }],
        ctx,
      );
      done.push(label);
      return { id, seq: Number(seq), label };
    };
    const appRun = (label: string) =>
      db.run("INSERT INTO hx_log (label) VALUES (?)", label).then(() => {
        done.push(label);
      });
    const appTx = (label: string) =>
      db.transaction(async (tx) => {
        const before = await tx.get<{ n: number }>("SELECT count(*) AS n FROM pi_entries");
        await tick();
        await tx.run("INSERT INTO hx_log (label) VALUES (?)", `${label}:a`);
        await tick();
        // No Pi commit slipped in while this transaction awaited.
        expect(await tx.get("SELECT count(*) AS n FROM pi_entries")).toEqual(before);
        await tx.run("INSERT INTO hx_log (label) VALUES (?)", `${label}:b`);
        done.push(label);
      });

    // Fire everything without awaiting between calls.
    const issued = [
      appRun("app-1"),
      piEntry("pi-1"),
      appTx("tx-1"),
      piEntry("pi-2"),
      appRun("app-2"),
      piEntry("pi-3"),
      appTx("tx-2"),
      appRun("app-3"),
    ];
    const results = await Promise.all(issued);

    expect(await labels(db)).toEqual(["app-1", "tx-1:a", "tx-1:b", "app-2", "tx-2:a", "tx-2:b", "app-3"]);
    const pi = results.filter((r): r is { id: EntryId; seq: number; label: string } => typeof r === "object" && r !== null);
    expect(pi.map((r) => r.label)).toEqual(["pi-1", "pi-2", "pi-3"]);
    expect(pi.map((r) => r.seq)).toEqual([...pi.map((r) => r.seq)].sort((a, b) => a - b));
    for (const r of pi) expect((await storage.entry(r.id, ctx))?.entry.data).toEqual({ label: r.label });
    // Completion order is not exactly issue order (piEntry awaits mintId first), but app ops kept their order and
    // every app op finished before the next app op issued after it.
    expect(done.filter((l) => !l.startsWith("pi"))).toEqual(["app-1", "tx-1", "app-2", "tx-2", "app-3"]);

    // Pi's tables live beside hx_ ones in the same file.
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
      (row) => row.name,
    );
    expect(tables).toContain("hx_log");
    expect(tables.some((name) => name.startsWith("pi_"))).toBe(true);
    expect(tables.every((name) => name.startsWith("pi_") || name.startsWith("hx_") || name.startsWith("sqlite_"))).toBe(true);

    // Storage owns close of the shared facade; reopen the file and see both layers' state.
    await storage.close(ctx);
    const again = await home();
    const reopened = await SqliteStorage.open(again, { prefix: "pi_" });
    expect((await reopened.entry(pi[2]!.id, ctx))?.entry.data).toEqual({ label: "pi-3" });
    expect(await labels(again)).toHaveLength(7);
    await reopened.close(ctx);
  });

  test("a Pi commit issued while an app transaction is open lands after it, not inside its rollback", async () => {
    const db = await home();
    const storage = await SqliteStorage.open(db, { prefix: "pi_" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let piCommit: Promise<number> | undefined;

    const appTx = db.transaction(async (tx) => {
      await tx.run("INSERT INTO hx_log (label) VALUES (?)", "doomed");
      piCommit = commitWrites(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], ctx);
      await gate;
      throw new Error("app rollback");
    });
    await tick();
    release();
    await expect(appTx).rejects.toThrow("app rollback");
    await piCommit;

    expect(await labels(db)).toEqual([]);
    expect(await storage.conversation(ROOT_CONVERSATION_ID, ctx)).toBeDefined();
    await storage.close(ctx);
  });
});
