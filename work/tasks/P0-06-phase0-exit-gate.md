---
id: P0-06
title: Phase 0 exit gate — record decisions as ADRs
status: done
owner: coordinator
branch: llm/gifted-galileo-atanlf
depends_on: [P0-02, P0-03, P0-04, P0-05]
owns: [docs/decisions/, work/BOARD.md]
---

## Goal

Turn Phase 0 evidence into durable decisions and unblock Phase 1. BUILD_PLAN Phase 0 exit gate.

## Acceptance

- [x] ADRs for: SQLite adapter, ownership mechanism, terminal renderer — each linking its evidence.
- [x] Any boundary that failed is resolved or escalated to Brian; the single-home / continued-interaction contract is not silently changed.
- [x] DESIGN/BUILD_PLAN updated only where a decision is now exercised.
- [x] Phase 1 decomposed into task files and BOARD updated.

## Out of scope

- Implementing Phase 1.

## Notes / handoff

- 2026-11-03 coordinator: ADRs 0001–0004 written. No boundary failed on Linux; every macOS criterion moved to P0-07 instead of being silently dropped. Phase 1 decomposed (P1-01..04). BUILD_PLAN/AGENTS updated with exercised decisions only.
