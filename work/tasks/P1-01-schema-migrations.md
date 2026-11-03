---
id: P1-01
title: Home schema, compatibility check, and migrations
status: claimed
owner: P1-01-agent
branch: agent/P1-01-schema-migrations
depends_on: [P0-02]
owns: [src/home/schema*, src/home/migrations*, evidence/P1-01/]
---

## Goal

`hx_meta` (home identity, format/app/runtime compatibility) and `hx_migrations`, with an ordered migration runner on the shared facade. DESIGN § 3; BUILD_PLAN Phase 1.

## Acceptance

- [ ] Fresh home gets a stable home id, format version, and creating app version in `hx_meta`.
- [ ] Migrations are ordered, recorded, and each runs in one transaction; a failing migration rolls back fully and leaves the home at the prior version.
- [ ] A home with a newer/unknown format fails clearly with no write attempted. No destructive migration.
- [ ] Runner coexists with `SqliteStorage.open(db, { prefix: "pi_" })` on the same file; `hx_`/`pi_` namespaces never collide.
- [ ] Decide what replaces the P0-03 stub `hx_files` schema (throwaway homes are fine; document it).

## Out of scope

- CLI wiring (P1-02), VFS tables beyond a placeholder decision (Phase 2).

## Notes / handoff
