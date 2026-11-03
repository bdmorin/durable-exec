---
id: P1-04
title: config and status commands
status: open
owner:
branch:
depends_on: [P1-02]
owns: [src/cli/commands/config*, src/cli/commands/status*, src/home/config*, evidence/P1-04/]
---

## Goal

`--home FILE status` and `--home FILE config get|set|list` over structured `hx_settings`, with documented precedence (invocation > documented env > home > default) and recorded sources. DESIGN § 3, 6, 7.

## Acceptance

- [ ] `status` reports agents/workspaces/runs/required bindings (empty is fine now) without starting the Pi scheduler or any model call.
- [ ] Precedence is tested; the resolved value reports its source.
- [ ] Credential bindings are stored as env-var *names*; values are never stored or printed; redaction tested.
- [ ] `--json` output is machine-clean on stdout; diagnostics on stderr.
- [ ] Settings changes are versioned so later run provenance can reference a revision.

## Notes / handoff
