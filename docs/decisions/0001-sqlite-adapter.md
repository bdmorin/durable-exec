# 0001: Reuse Chord's node:sqlite adapter for the home database

- Status: accepted (Linux x86_64); macOS arm64 pending
- Task: P0-02
- Evidence: [../../evidence/P0-02/README.md](../../evidence/P0-02/README.md)

## Context

DESIGN § 4 requires one serialized async facade shared by `hx_*` code and pi-durable's `SqliteStorage`, satisfying Chord's `SqliteDatabase` contract. Bun's native `db.transaction()` is synchronous and must never wrap an async callback.

## Options considered

- **Chord 1.5.0 `NodeSqliteDatabase` over `node:sqlite`** (Bun 1.4.4 provides `node:sqlite`). It has one serial queue, explicit `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`, handles that are invalidated once the callback settles, and an `AggregateError` on rollback failure. Under Bun every required behavior passed, as did pi-durable's 32-case storage conformance suite and a compiled-binary reopen.
- **Hand-written `bun:sqlite` adapter.** Not needed. Probes reconfirmed both traps it would have to avoid: the async-in-sync `transaction()` leaves rows committed after an awaited throw, and BEGIN/ROLLBACK without a queue lets an unrelated write join the transaction.

## Decision

`src/db/home-database.ts` exposes `openHomeDatabase(path, options)`. It builds Chord's adapter from public exports rather than calling `openNodeSqliteDatabase`, which creates parent directories and forces `synchronous=NORMAL`. Defaults: WAL, `synchronous=FULL`, `busy_timeout=5000`, `foreign_keys=ON`, no `locking_mode`. `initSql` runs before the WAL setup.

## Consequences

- One connection per home. Close Pi storage last, because `SqliteStorage.close()` closes the shared facade.
- Calling the database itself inside a transaction callback deadlocks (part of the contract). Use the handle.
- Swapping adapters stays local to `src/db/`. Revisit if `node:sqlite` under Bun regresses, or if multiple readers per process become necessary.
