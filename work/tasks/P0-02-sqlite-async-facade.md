---
id: P0-02
title: Shared async SQLite facade with awaited rollback
status: review
owner: P0-02-agent
branch: agent/P0-02-sqlite-async-facade
depends_on: [P0-01]
owns: [src/db/, evidence/P0-02/]
---

## Goal

One serialized database facade shared by `hx_*` application code and Pi's `SqliteStorage`, implementing Chord's async `SqliteDatabase` contract over `bun:sqlite` (or reusing an existing compatible adapter if one meets the shared-connection requirements). BUILD_PLAN Phase 0 step 3; DESIGN § 4.

## Acceptance

- [x] Explicit BEGIN/COMMIT/ROLLBACK; Bun's synchronous `db.transaction()` is never handed an async callback.
- [x] Test: interleaved app + Pi operations stay serialized and ordered.
- [x] Test: an error thrown *after an await* inside a transaction rolls back every write in it.
- [x] Test: a settled transaction handle is invalidated (use after commit/rollback fails loudly).
- [x] Unrelated operations queue rather than slip into an open transaction.
- [x] Evidence notes whether an existing adapter was reused and why/why not.

## Out of scope

- Schema/migrations (Phase 1). Ownership locking (P0-04).

## Notes / handoff

- Known trap, observed in design probes: Bun's native transaction wrapper around an async callback left rows committed after an awaited failure. Reproduced again under Bun 1.4.4 (see evidence).
- Decision: reuse Chord 1.5.0 `NodeSqliteDatabase` over `node:sqlite` (Bun-provided). There is no `bun:sqlite` adapter. Entry point: `openHomeDatabase(path, options)` in `src/db/home-database.ts`, which keeps the choice local.
- pi-durable's Storage conformance suite (32 cases) passes against `SqliteStorage` over this facade on a temp file.
- Works inside a `bun build --compile` binary (Linux x86_64). P0-03 can build on it.
- For P0-04: one connection, never closed and reopened by the adapter. `initSql` runs before WAL setup, so `locking_mode` can be injected there; nothing is set by default. Beware POSIX fcntl lock loss if the home file is opened and closed separately in-process.
- `SqliteStorage.close()` closes the shared facade, so close Pi storage last.
- Open: macOS arm64 not exercised. The ADR for the adapter is left to P0-06 (exit gate).
