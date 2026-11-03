---
id: P1-03
title: Invocation journal (local operational metadata)
status: open
owner:
branch:
depends_on: [P1-01]
owns: [src/telemetry/, evidence/P1-03/]
---

## Goal

Record each command activation against a selected home: invocation id, command kind, timestamps, outcome (including errors and dry-runs), with no credentials, env dumps, or arbitrary argument payloads. DESIGN § 9; BUILD_PLAN Phase 1.

## Acceptance

- [ ] Successful, failed, and dry-run invocations each leave one journal record with an outcome.
- [ ] Test: argument values and env vars, including a fake `*_API_KEY`, never appear in the home (grep the file bytes).
- [ ] Policy hook exists for verbosity; default captures only safe metadata.
- [ ] Journal writes can't break the command they observe (journal failure → stderr diagnostic, command result unchanged).
- [ ] No exporter, beacon, or network use; nothing outside the home is written.

## Notes / handoff
