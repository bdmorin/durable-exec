---
id: P1-01
title: Home schema, compatibility check, and migrations
status: review
owner: P1-01-agent
branch: agent/P1-01-schema-migrations
depends_on: [P0-02]
owns: [src/home/schema*, src/home/migrations*, evidence/P1-01/]
---

## Goal

`hx_meta` (home identity, format/app/runtime compatibility) and `hx_migrations`, with an ordered migration runner on the shared facade. DESIGN § 3; BUILD_PLAN Phase 1.

## Acceptance

- [x] Fresh home gets a stable home id, format version, and creating app version in `hx_meta`.
- [x] Migrations are ordered, recorded, and each runs in one transaction; a failing migration rolls back fully and leaves the home at the prior version.
- [x] A home with a newer/unknown format fails clearly with no write attempted. No destructive migration.
- [x] Runner coexists with `SqliteStorage.open(db, { prefix: "pi_" })` on the same file; `hx_`/`pi_` namespaces never collide.
- [x] Decide what replaces the P0-03 stub `hx_files` schema (throwaway homes are fine; document it).

## Out of scope

- CLI wiring (P1-02), VFS tables beyond a placeholder decision (Phase 2).

## Notes / handoff

Evidence: [evidence/P1-01/README.md](../../evidence/P1-01/README.md). Linux x86_64 only (Bun 1.4.4); macOS not exercised.

- API: `checkHomeFile(path, { create })` **before** `openHomeDatabase` (opening is itself a write for rollback-journal and empty files), then `prepareHome(db, { create, appVersion })` → `{ homeId, formatVersion, created, applied }`. Typed `HomeFormatError` (`missing | not-a-file | not-sqlite | not-a-home | uninitialized | newer-format | inconsistent`) and `HomeMigrationError`. No CLI or ownership dependency; P1-02 passes `VERSION`.
- No write on refusal: proven by identical SHA-256 and no `-wal`/`-shm` companions after the file check (read-only, `immutable=1` unless a hot WAL exists), and `total_changes() = 0` plus identical bytes after close on the facade path.
- Migrations: one file per migration `src/home/migrations/NNNN-<name>.ts`, appended to `MIGRATIONS` in `index.ts`; ids contiguous from 1; second to merge renumbers. Runner rolls back any migration that changes a non-`hx_` object. Format version = last applied migration id.
- `hx_files`: not defined by migration 1; Phase 2 owns it. P0-03 stub untouched; stub-only probe homes are refused as `not-a-home` (recreate them). If the stub ever runs on a real home first, Phase 2's migration must handle the pre-existing table.
- Not exercised: macOS, a real crash with a hot WAL (simulated with an open writer), compiled binary/CLI (P1-02).
