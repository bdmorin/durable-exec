# 0002: Home ownership via flock on a companion file

- Status: accepted (Linux x86_64); macOS arm64 pending
- Task: P0-04
- Evidence: [../../evidence/P0-04/README.md](../../evidence/P0-04/README.md)

## Context

DESIGN § 4: exactly one writable owner per home, surviving crashes without two live owners. No stale-PID deletion and no leases, so a paused owner keeps ownership. Aliases of the same home must not yield two owners.

## Options considered

- **POSIX `fcntl` lock on the home.** Rejected, and refuted by a probe: the lock is per-process, so it was silently dropped when SQLite closed its own fd, and a competitor then acquired it.
- **SQLite `locking_mode=EXCLUSIVE`.** Works, but ties ownership to one connection. It was lost when the `Database` object was garbage-collected, it blocks other processes from reading for status, and a check needs SQLite open first. It remains available through `initSql` as a second layer.
- **`flock(LOCK_EX|LOCK_NB)` via `bun:ffi` on `<realpath(home)>-hxowner`.** Chosen.

## Decision

`acquireHomeOwnership(path)` in `src/home/ownership.ts`. The lock belongs to the open file description, and the kernel releases it on death. The module never opens the home. Paths are canonicalized with realpath, and homes with `nlink != 1` are refused, since hard links can't be detected from a path. Order: acquire → `openHomeDatabase` → … → `close()` → `release()`.

## Consequences

- Never delete `*-hxowner` files. Deleting one while the home is owned breaks exclusion. It is gitignored and documented as transient operational state.
- The lock is advisory: tools that bypass the module can still write.
- Network filesystems are unsupported and not detected. musl is not handled.
- **macOS proof outstanding.** The libSystem errno path and `EWOULDBLOCK=35` have never executed. BSD `flock`/`fcntl` interaction is why the lock is on a companion file. Run `bun test src/home/ownership.test.ts` on macOS arm64 to close.
