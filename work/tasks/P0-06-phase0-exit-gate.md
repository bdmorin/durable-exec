---
id: P0-06
title: Phase 0 exit gate — record decisions as ADRs
status: claimed
owner: coordinator
branch: llm/gifted-galileo-atanlf
depends_on: [P0-02, P0-03, P0-04, P0-05]
owns: [docs/decisions/, work/BOARD.md]
---

## Goal

Turn Phase 0 evidence into durable decisions and unblock Phase 1. BUILD_PLAN Phase 0 exit gate.

## Acceptance

- [ ] ADRs for: SQLite adapter, ownership mechanism, terminal renderer — each linking its evidence.
- [ ] Any boundary that failed is resolved or escalated to Brian; the single-home / continued-interaction contract is not silently changed.
- [ ] DESIGN/BUILD_PLAN updated only where a decision is now exercised.
- [ ] Phase 1 decomposed into task files and BOARD updated.

## Out of scope

- Implementing Phase 1.

## Notes / handoff
