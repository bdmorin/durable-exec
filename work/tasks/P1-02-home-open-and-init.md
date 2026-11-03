---
id: P1-02
title: Home selection, init, and the owned-open lifecycle
status: open
owner:
branch:
depends_on: [P1-01, P0-04]
owns: [src/home/open*, src/home/select*, src/cli/commands/init*, evidence/P1-02/]
---

## Goal

One `openHome()` composition used by every command: select → acquire ownership → `openHomeDatabase` → compatibility/migrate → … → close → release. Plus `horcrux init FILE`. DESIGN § 6–7; BUILD_PLAN Phase 1.

## Acceptance

- [ ] `--home` overrides `HORCRUX_HOME`. No directory scanning, no implicit creation; a missing home is a clear error.
- [ ] `init FILE` creates a 0600 home with schema and explicit defaults, no grants; refuses to overwrite an existing path.
- [ ] Running without a home prints help, writes nothing, makes no network request (existing P0-01 test stays green).
- [ ] A second writer gets a clear "home is owned" error (`HomeOwnedError` surfaced, exit code documented).
- [ ] Hardlinked/odd homes surface `HomeOwnershipError` codes readably.
- [ ] Exercised via the compiled binary, not just `bun run`.

## Out of scope

- Attach/client mode to a running owner (needs Phase 5's server; record the CLI shape only).

## Notes / handoff
