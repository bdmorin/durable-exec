---
id: P0-01
title: Pinned Bun/TypeScript tooling baseline
status: open
owner:
branch:
depends_on: []
owns: [package.json, bun.lock, tsconfig.json, bunfig.toml, evidence/P0-01/]
---

## Goal

Create the real package setup every other task builds on: Bun + TypeScript, pi-durable / pi-ai / Chord pinned to the exercised 1.5.0 family, Commander pinned after validating under Bun, a working `bun test`, and a `bun build --compile` command that produces a binary in `dist/`. BUILD_PLAN Phase 0 step 1.

## Acceptance

- [ ] `package.json` with exact (non-range) versions; `bun.lock` committed.
- [ ] Commander version chosen and shown working under Bun (its Node engine field is not proof).
- [ ] `bun test` runs (one real test is fine; no placeholder tests that assert nothing).
- [ ] A compile script emits `dist/horcrux` from a minimal entry that prints help and exits 0 without touching disk.
- [ ] Evidence: Bun/Node/OS/arch, install + compile commands and output.

## Out of scope

- Application modules beyond the minimal entry point. No `src/*` scaffolding.
- Choosing the terminal renderer (P0-05) or SQLite adapter (P0-02).

## Notes / handoff
