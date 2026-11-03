---
id: P0-02
title: Shared async SQLite facade with awaited rollback
status: open
owner:
branch:
depends_on: [P0-01]
owns: [src/db/, evidence/P0-02/]
---

## Goal

One serialized database facade shared by `hx_*` application code and Pi's `SqliteStorage`, implementing Chord's async `SqliteDatabase` contract over `bun:sqlite` (or reusing an existing compatible adapter if one meets the shared-connection requirements). BUILD_PLAN Phase 0 step 3; DESIGN § 4.

## Acceptance

- [ ] Explicit BEGIN/COMMIT/ROLLBACK; Bun's synchronous `db.transaction()` is never handed an async callback.
- [ ] Test: interleaved app + Pi operations stay serialized and ordered.
- [ ] Test: an error thrown *after an await* inside a transaction rolls back every write in it.
- [ ] Test: a settled transaction handle is invalidated (use after commit/rollback fails loudly).
- [ ] Unrelated operations queue rather than slip into an open transaction.
- [ ] Evidence notes whether an existing adapter was reused and why/why not.

## Out of scope

- Schema/migrations (Phase 1). Ownership locking (P0-04).

## Notes / handoff

- Known trap, observed in design probes: Bun's native transaction wrapper around an async callback left rows committed after an awaited failure.
