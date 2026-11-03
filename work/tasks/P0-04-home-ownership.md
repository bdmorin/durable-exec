---
id: P0-04
title: Select and exercise single-owner home exclusion
status: claimed
owner: P0-04-agent
branch: agent/P0-04-home-ownership
depends_on: []
owns: [src/home/ownership*, evidence/P0-04/]
---

## Goal

Choose a platform-supported mechanism guaranteeing exactly one writable owner per home, surviving crashes without two live owners. BUILD_PLAN Phase 0 step 4; DESIGN § 4. Can start immediately with bare `bun:sqlite`/`bun` — no dependency on P0-01's package setup beyond a test runner.

## Acceptance

- [ ] Candidate mechanisms compared in evidence (e.g. OS advisory lock on the home/sidecar, SQLite exclusive locking mode, lock on a stable inode identity) with why the winner wins.
- [ ] Exercised: two concurrent processes → exactly one owner, the other refused cleanly.
- [ ] Exercised: owner killed with SIGKILL → next process acquires without manual cleanup.
- [ ] Exercised: a merely paused owner (SIGSTOP) does **not** lose ownership.
- [ ] Exercised: aliases of the same home (symlink, relative vs absolute, hardlink) cannot produce two owners.
- [ ] No stale-PID-file deletion heuristics. Network filesystems explicitly unsupported.
- [ ] Platform labeled; macOS arm64 is the target proof, Linux is supplementary.

## Out of scope

- Attach/client mode (Phase 1). Home schema.

## Notes / handoff
