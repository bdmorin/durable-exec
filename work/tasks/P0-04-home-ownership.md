---
id: P0-04
title: Select and exercise single-owner home exclusion
status: review
owner: P0-04-agent
branch: agent/P0-04-home-ownership
depends_on: []
owns: [src/home/ownership*, evidence/P0-04/]
---

## Goal

Choose a platform-supported mechanism guaranteeing exactly one writable owner per home, surviving crashes without two live owners. BUILD_PLAN Phase 0 step 4; DESIGN § 4. Can start immediately with bare `bun:sqlite`/`bun` — no dependency on P0-01's package setup beyond a test runner.

## Acceptance

- [x] Candidate mechanisms compared in evidence (e.g. OS advisory lock on the home/sidecar, SQLite exclusive locking mode, lock on a stable inode identity) with why the winner wins.
- [x] Exercised: two concurrent processes → exactly one owner, the other refused cleanly. (Linux, 8 racing processes)
- [x] Exercised: owner killed with SIGKILL → next process acquires without manual cleanup. (Linux)
- [x] Exercised: a merely paused owner (SIGSTOP) does **not** lose ownership. (Linux)
- [x] Exercised: aliases of the same home (symlink, relative vs absolute, hardlink) cannot produce two owners. (Linux; hardlinked homes are refused outright)
- [x] No stale-PID-file deletion heuristics. Network filesystems explicitly unsupported.
- [ ] Platform labeled; macOS arm64 is the target proof, Linux is supplementary. — **Linux only so far.** Run `bun test src/home/ownership.test.ts` on macOS arm64 to close this.

## Out of scope

- Attach/client mode (Phase 1). Home schema.

## Notes / handoff

- Mechanism: `flock(LOCK_EX|LOCK_NB)` through `bun:ffi` on the companion file `<realpath(home)>-hxowner`, plus a `nlink == 1` rule. Module: `src/home/ownership.ts`. Tests: `src/home/ownership.test.ts`, which spawns real processes through `ownership.fixture.ts`. Evidence: `evidence/P0-04/README.md`.
- Rebased onto `llm/gifted-galileo-atanlf` (P0-02). The tests exercise ownership together with `openHomeDatabase` held open in the owner process. No change to `src/db/` is needed. Order: acquire ownership → `openHomeDatabase` → … → `close()` → `release()`.
- Trap confirmed (probe B): a POSIX `fcntl` lock on the home is silently dropped when SQLite closes its fd in the same process. A second trap (probe E): `locking_mode=EXCLUSIVE` ownership vanishes when the `Database` object is garbage-collected.
- macOS differences to verify:
  - BSD `flock` and `fcntl` locks interact. That is why the lock is on a companion file, not the home.
  - The libSystem `__error` errno path and `EWOULDBLOCK = 35` have never been executed.
  - There is no public `F_OFD_SETLK`.
  - Calling variadic `fcntl` through FFI is unsafe on Apple arm64.
- Follow-ups outside this lane, for the coordinator or P0-06:
  - Write the ownership ADR in `docs/decisions/`.
  - Add `*-hxowner` to `.gitignore`.
  - Never delete the companion file. Deleting it while the home is owned breaks exclusion.
