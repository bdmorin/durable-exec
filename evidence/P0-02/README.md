# P0-02 evidence: shared async SQLite facade

- **Platform:** Linux x86_64 (cloud container), Bun 1.4.4, Node 22.23.4 (Node not used at runtime). macOS arm64 not exercised.
- **Packages:** `@earendil-works/chord` 1.5.0, `@earendil-works/pi-durable` 1.5.0. No dependency added; `package.json` / `bun.lock` untouched.
- **SQLite:** `node:sqlite` under Bun reports `sqlite_version()` 3.53.4.

## Decision: reuse Chord's `NodeSqliteDatabase` over `node:sqlite`; no `bun:sqlite` adapter written

`src/db/home-database.ts` exports `openHomeDatabase(path, options)`, which builds a `node:sqlite` `DatabaseSync` and wraps it in Chord's `NodeSqliteDatabase` (`@earendil-works/chord/sqlite/node`). The app and `SqliteStorage.open(db, { prefix: "pi_" })` share that one object.

Why reuse:

- Reading `chord/dist/sqlite/node.js`: one `SerialOperationQueue` for all calls, `transaction` runs `BEGIN IMMEDIATE` … `COMMIT` / `ROLLBACK` by hand, and the handle's `runOperation` throws `SQLite transaction handle is no longer active` once the callback settles. If ROLLBACK fails it throws an `AggregateError`. It never calls Bun's `db.transaction()`. That is the `SqliteDatabase` doc-comment contract.
- Every required behavior below passes on it under Bun, and so does pi-durable's own Storage conformance suite.
- It is the adapter pi-durable's own `openNodeSqliteStorage` uses, so Pi runs on the same path its authors test.
- It also works inside a `bun build --compile` binary (below).

Why not `openNodeSqliteDatabase` itself: it `mkdir -p`s the parent directory implicitly (ambient side effect), forces `synchronous=NORMAL`, and accepts no pre-WAL pragmas, which P0-04 may need. `openHomeDatabase` builds the same object from Chord's public exports with injectable settings.

Negative control (scratch probe, now deleted), which shows the trap is real under Bun 1.4.4:

```
(a) bun:sqlite db.transaction(async cb) with a throw after an await:
    rejected: boom after await
    rows after awaited failure: [ { label: "tx-1" }, { label: "tx-2" } ]   <- committed despite failure
(b) hand-rolled BEGIN/ROLLBACK with no queue: an unrelated run issued during the tx
    rows after rollback: []   <- the outside write slipped in and was rolled back with the tx
```

## Settings chosen (all injectable via `HomeDatabaseOptions`)

| Setting | Default | Note |
| --- | --- | --- |
| `busyTimeoutMs` | 5000 | Passed to `DatabaseSync({ timeout })`; verified via `PRAGMA busy_timeout` |
| `journalMode` | `WAL` | Open fails if SQLite refuses the mode on a file |
| `synchronous` | `FULL` | Unlike Chord's `NORMAL`: a reported commit survives power loss, not only a crash |
| `walAutoCheckpointPages` | SQLite default (1000) | Applied only when set |
| `foreign_keys` | ON | `node:sqlite` already defaults to ON; set explicitly |
| `initSql` | none | Runs right after open, **before** `journal_mode`, for P0-04 (e.g. `PRAGMA locking_mode = EXCLUSIVE`) |
| `locking_mode` | not set (`normal`) | Deliberately left to P0-04 |

## Constraints for P0-03 / P0-04

- **One connection per facade**, opened once in `openHomeDatabase` and closed only by `close()`. The adapter never closes and reopens the file. `close()` runs `PRAGMA wal_checkpoint(TRUNCATE)`, then closes, and the `-wal`/`-shm` files go away.
- WAL mode opens the companion files `<home>-wal` and `<home>-shm`. With `locking_mode=EXCLUSIVE` set through `initSql` before WAL, SQLite documents that the WAL index lives in heap memory with no `-shm` file (not observed here). The test only checks that the pragma combination is accepted; behavior across two processes is not checked here.
- **POSIX fcntl hazard:** SQLite's own locks are fcntl locks on the home file. If P0-04 opens the home file itself (for example `fs.open` + close to take an OS lock), closing *any* descriptor on that file in this process releases SQLite's fcntl locks too. A lock on a sibling file, or SQLite's `locking_mode=EXCLUSIVE`, avoids this.
- **`SqliteStorage.close()` closes the shared facade** (`storage.js` `closeDatabase` → `db.close()`). The app must treat Pi storage as the closer, or close the facade only after Pi is done. `close()` is idempotent.
- Calling the facade itself (not the handle) from inside a `transaction` callback **and awaiting it** deadlocks, as the contract says. Firing it without awaiting is fine: it runs after commit or rollback (tested).
- `node:sqlite` works in a compiled binary, so P0-03 can build on `openHomeDatabase` directly.

## Commands

```bash
bun install
bun test               # 45 pass, 0 fail (11 facade + 32 Pi conformance + 2 P0-01 CLI)
bun run typecheck      # clean
bun test src/db/pi-storage-conformance.test.ts   # 32 pass, 0 fail, 721 expect() calls
```

Compiled check (scratch entry, deleted afterwards). It opens the home, creates the Pi root conversation, inserts an `hx_` row, runs a transaction that throws after an await, then closes. It was run twice on the same file, from a directory with no `node_modules`:

```bash
bun build ./scratch/compiled-probe.ts --compile --outfile scratch/probe-bin
cd <empty dir> && ./probe-bin <empty dir>/home.horcrux && ./probe-bin <empty dir>/home.horcrux && ls -A
```

```
  [15ms]  bundle  26 modules
[1335ms] compile  scratch/probe-bin
{"bun":"1.4.4","journal":{"journal_mode":"wal"},"rollback":"boom","doomedPresent":false,"hxRows":1,"piRoot":true}
{"bun":"1.4.4","journal":{"journal_mode":"wal"},"rollback":"boom","doomedPresent":false,"hxRows":2,"piRoot":true}
home.horcrux
probe-bin
```

On the second run, Pi state and app state from the first run are both there, and the rolled-back row is absent each time.

## Tests (`src/db/home-database.test.ts`, temp-file DBs)

All tests use a `mkdtemp` file `home.horcrux`, never `:memory:`.

- **Settings:** defaults (WAL, FULL, 5 s, `locking_mode` normal, one attached DB); injected options including `initSql` exclusive locking; state survives close and reopen.
- **Awaited rollback:** writes, `await` timer, writes, throw. The promise rejects with the *same* error object, no tx rows remain, and a fresh connection on the file also sees none.
- **Handle invalidation:** a handle used after commit or after rollback rejects with `no longer active` (`run`, `all`, `exec`). A handle leaked into a timer that fires after commit cannot write.
- **Unrelated op queues:** a tx is held open on a gate, and `db.run("outside")` plus a `db.all` are issued meanwhile. They do not run until the tx rolls back, `outside` survives the rollback (so it was not inside the tx), and the queued read sees `["outside"]` only.
- **Second transaction queues behind first.**
- **Failed COMMIT** (deferred FK violation) rejects, and the connection is clean and usable afterwards.
- **Interleaved app + Pi:** with a real `SqliteStorage` (`pi_` prefix) and an `hx_log` table, 8 operations are fired without awaiting: app runs, app transactions, and Pi `commit`s. `hx_log` ends in issue order. Pi seqs increase in issue order. Inside each app transaction, `pi_entries` count is unchanged across awaits, so no Pi commit slipped in. Only `pi_*`/`hx_*` tables exist, and both layers' state survives reopen.
- **Pi commit issued inside an app tx callback (not awaited):** it lands after the app tx rolls back. The app rows are gone and the Pi row is present.

`src/db/pi-storage-conformance.test.ts` runs pi-durable's `registerStorageConformance` (32 cases) against `SqliteStorage.open(openHomeDatabase(tempfile), { prefix: "pi_" })`. All pass.

## Not exercised

- macOS arm64 (target platform), both under `bun test` and compiled.
- Two processes on one home: busy-timeout behavior under real contention, `locking_mode=EXCLUSIVE` across processes (P0-04).
- ROLLBACK itself failing (the `AggregateError` path). It is read in the Chord source, not provoked.
- Crash or power-loss durability of `synchronous=FULL`.
- Long-running, large, or concurrent-read performance; statement-cache eviction (Chord caps it at 256).
- The real `src/main.ts` binary does not use the facade yet. The compiled check used a scratch entry.
