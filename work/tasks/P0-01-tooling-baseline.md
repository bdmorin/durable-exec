---
id: P0-01
title: Pinned Bun/TypeScript tooling baseline
status: done
owner: coordinator
branch: llm/gifted-galileo-atanlf
depends_on: []
owns: [package.json, bun.lock, tsconfig.json, bunfig.toml, evidence/P0-01/]
---

## Goal

Create the real package setup every other task builds on: Bun + TypeScript, pi-durable / pi-ai / Chord pinned to the exercised 1.5.0 family, Commander pinned after validating under Bun, a working `bun test`, and a `bun build --compile` command that produces a binary in `dist/`. BUILD_PLAN Phase 0 step 1.

## Acceptance

- [x] `package.json` with exact (non-range) versions; `bun.lock` committed.
- [x] Commander version chosen and shown working under Bun (its Node engine field is not proof).
- [x] `bun test` runs (one real test is fine; no placeholder tests that assert nothing).
- [x] A compile script emits `dist/horcrux` from a minimal entry that prints help and exits 0 without touching disk.
- [x] Evidence: Bun/Node/OS/arch, install + compile commands and output.

## Out of scope

- Application modules beyond the minimal entry point. No `src/*` scaffolding.
- Choosing the terminal renderer (P0-05) or SQLite adapter (P0-02).

## Notes / handoff

- 2026-11-03: Done on Linux x86_64. See evidence/P0-01. Typecheck via `bun run typecheck`. Next lanes unblocked: P0-02, P0-05.
