# P0-04 evidence: single-owner home exclusion

**Platform: Linux only.** Everything below ran on Linux. macOS arm64 is the target and has **not** been exercised.

| | |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS, kernel 6.18.44, x86_64, glibc 2.39 |
| Filesystem | ext4 (local), test homes under `os.tmpdir()` |
| Bun | 1.4.4 (38afee6c8); `bun:sqlite` reports SQLite 3.53.4 (Bun's bundled copy on Linux) |
| Node | v22.23.4 (not used by the module or tests) |
| Dependencies | none. Only `bun:ffi`, `bun:sqlite`, and `node:fs`/`os`/`path` |

## Decision

**A non-blocking exclusive `flock(2)` on a companion file `<realpath(home)>-hxowner`, called through `bun:ffi`, and held for the life of the owner process.** A home with `st_nlink != 1` is refused.

Implementation: [`src/home/ownership.ts`](../../src/home/ownership.ts). The API is `acquireHomeOwnership(path): Promise<OwnershipHandle>`. The handle has `release()`, `canonicalPath`, `dev`, `ino` and `lockPath`. A held home throws `HomeOwnedError` (`code: "owned"`). Homes that can't be owned safely throw `HomeOwnershipError`, with `code` set to `missing`, `not-a-file`, `hardlinked` or `changed`. The call never waits and never creates the home.

Why it wins:

1. **The kernel releases the lock on death.** A SIGKILLed owner leaves no state that needs recovery. The companion file stays behind, but it has no meaning unless someone holds a lock on it. There is no PID file, lease or timeout, so a paused owner keeps ownership indefinitely.
2. **The lock belongs to the open file description, not the process.** SQLite opening and closing the home in the owner process can't drop it. That is the POSIX `fcntl` trap, reproduced in probe B below. A second acquire in the same process is refused too.
3. **It doesn't depend on the SQLite connection.** Ownership can be taken *before* a writable harness is opened (DESIGN §4: "Reject a competing owner before opening a writable harness"). It doesn't limit how many connections or readers the owner uses, and it can't be lost because a `Database` object was garbage-collected (probe E vs E3).
4. **It works the same on Linux and macOS, as far as the APIs go.** `flock(int, int)` is not variadic, and BSD and Linux share the `LOCK_*` values. Of the candidates, it is the only one with no variadic FFI call and no OFD dependency.

Why the lock is on a companion file and not the home: on Linux, `flock` and `fcntl` locks are independent, and `flock` on the home itself works (probe D). On macOS and FreeBSD, `flock`, `fcntl` and `lockf` locks **interact** (see the [Stack Overflow answer](https://stackoverflow.com/questions/22409780/flock-vs-lockf-on-linux) and the [apenwarr locking notes](https://apenwarr.ca/log/20101213-everything-you-never-wanted-to-know-about-file-locking)). An exclusive whole-file `flock` on the home would then conflict with SQLite's own `fcntl` byte-range locks, even inside the owner process. The likely result is `SQLITE_BUSY` on the owner's first read. This is **not verified on a Mac**. The companion avoids the question entirely: SQLite never opens it.

Cost of the companion: a path can't detect a hardlink alias, so a home with more than one link is refused. See the alias handling section.

## Candidates compared

Probes ran as separate `bun` processes on one home. The holder took the lock and stayed alive. A fresh process then made each check. All locks were non-blocking.

| Probe | Holder does | Competitor result | Verdict |
| --- | --- | --- | --- |
| A | POSIX `fcntl(F_SETLK)` write lock on 1 byte of the home (offset 0x70000000, outside SQLite's lock bytes) | POSIX: refused (EAGAIN). OFD: refused | correct while the holder never touches the file |
| **B** | same as A, then opens `bun:sqlite` on the home, writes, `close()` | **POSIX: ACQUIRED. OFD: ACQUIRED** | **rejected.** Closing *any* fd on the inode drops the process's POSIX locks, so ownership is silently lost |
| C | Linux OFD `fcntl(F_OFD_SETLK)` on the same byte, then SQLite open/write/close | OFD refused, POSIX refused. Plain SQLite write still OK (advisory) | works on Linux. Rejected because macOS has no public `F_OFD_SETLK`, and `fcntl` is variadic, so calling it through FFI on Apple arm64 is unsafe |
| D | `flock(LOCK_EX)` on the home itself, then SQLite open/write/close | flock refused. Another process's SQLite read and write still work | works on Linux. Rejected for macOS because BSD flock and SQLite's fcntl locks interact (see above) |
| E | `PRAGMA locking_mode=EXCLUSIVE; journal_mode=WAL`, one write, `Database` object then unreachable | competitor read **and write succeeded** | trap: Bun finalized the unreachable `Database`, closed it, and dropped the lock |
| E3 | same as E, but the `Database` is kept reachable | read: `database is locked`. write: `database is locked`. Files: `home.db`, `home.db-wal` (**no `-shm`**) | works. A second connection *in the same process* is also refused (`database is locked`) |
| F3 | same as E3, but pragmas only and no write | read and write: `database is locked` | the switch to WAL under EXCLUSIVE already takes and keeps the lock |
| **chosen** | `flock(LOCK_EX\|LOCK_NB)` on `<realpath>-hxowner` | see tests | the separate open file description makes SQLite's activity on the home irrelevant |

SQLite `locking_mode=EXCLUSIVE`, the runner-up, is portable and kernel-released. With WAL it needs no `-shm`, and it is alias-proof because the lock sits on the inode. It was not chosen for four reasons:

- Ownership becomes a property of one connection. The owner process gets **exactly one** connection to the home. Any other in-process connection fails with `database is locked`, so pi-durable's storage and the app must share that single connection through the P0-02 facade.
- Ownership vanishes if that connection is closed, reopened for maintenance, or garbage-collected (probe E).
- No other process can read the home while it is owned, not even for status.
- The only way to check for an owner is to open the home with SQLite first.

It stays a reasonable defense-in-depth option for P0-02 on top of the flock, if the facade really does keep a single connection.

## Alias handling

- **symlink, symlinked directory, relative path, `..`, `//./`:** these converge through `realpath`, giving one companion path and one lock. Tested, all refused while owned.
- **bind mounts and macOS firmlinks:** the companion sits in the *same directory* as the home, so different mount paths of that directory reach the same companion inode. This is reasoned, **not tested**: no bind mount was available in this container.
- **hardlinks:** not detectable from a path, so the module checks the inode. `st_nlink != 1` → `HomeOwnershipError("hardlinked")`, through every name, whether the link already existed or was created while the home was owned. Tested. An owner from *before* the link was created keeps ownership. Everyone else is refused until the extra link is removed.
- After locking, the module re-checks that the companion at `lockPath` is the inode it locked (`lstat` vs `fstat`) and that the home still has the same `realpath`, dev/ino and a single link. If not, it throws `changed`. This guards against swaps during acquisition. That branch is not tested, because hitting the window needs a deterministic race.

## Replace or delete while owned

- **Home replaced** (`rename` over the path): the companion is still held, so a competitor at that path is refused (tested). The owner's existing SQLite connection still points at the old, now unlinked inode, and its writes go to that orphaned file. Detecting this belongs to the Phase 1 lifecycle work, not to this module.
- **Home deleted:** a competitor gets `missing` (tested). Ownership never creates a home (DESIGN §6: `init` is the only creation path).
- **Companion deleted while owned:** this **breaks exclusion**. A new process creates a fresh companion inode and locks it. This is inherent to any lock on a separate file and is documented as unsupported tampering. The module never deletes the companion itself, so stale ones are left in place (tested after SIGKILL).

## Exercised: permanent tests

```
bun test src/home/ownership.test.ts
```

```
bun test v1.4.4 (38afee6c8)

 12 pass
 0 fail
 40 expect() calls
Ran 12 tests across 1 file. [2.27s]
```

The suite was run 5 times in a row, 12/12 each time. Each test spawns real `bun` processes through `src/home/ownership.fixture.ts`. Per-test results from `--reporter=junit`:

```
racing acquirers produce exactly one owner; the rest are refused cleanly          0.33s   (8 processes, file barrier)
SIGKILLed owner: next acquire succeeds with no cleanup step                       0.05s
SIGSTOPped owner keeps ownership however long it is paused                        1.55s   (paused 1.5 s, then SIGCONT)
owner opening and closing the home with SQLite does not drop ownership            0.04s   (fcntl trap regression)
a child spawned by the owner does not inherit ownership after the owner dies      0.04s   (O_CLOEXEC; Bun sets it, fdinfo flags 02102002)
an explicit release lets another process acquire                                  0.04s
symlink, symlinked directory, relative path and '..' segments are all refused     0.12s
a hardlinked home is refused through every name, before or after the link appears 0.08s
a second acquire inside the owning process is refused too                         0.00s
a missing home is an error and nothing is created                                 0.00s
a directory is not a home                                                         0.00s
replacing the home file while owned does not admit a second owner at that path    0.04s
```

**Do the tests catch real breakage?** Three mutations were applied to `ownership.ts` one at a time, and each was reverted afterwards:

- Drop the `nlink` check → the hardlink test fails.
- Use the path without `realpath` → the alias, missing and replace tests fail.
- Swap `flock` on the companion for a POSIX `fcntl` lock on the home itself → the SQLite-close test and the same-process test fail (plus two companion-specific assertions).

## Commands for the probes

The probe scripts lived in `scratch/` and were deleted after the findings were recorded, as AGENTS.md requires. The essentials, if you need to reproduce them:

- `dlopen("libc.so.6", { flock(i32,i32)->i32, fcntl(i32,i32,ptr)->i32, __errno_location()->ptr })`
- The Linux x86_64 `struct flock` is 32 bytes: `l_type` i16 at 0, `l_whence` i16 at 2, `l_start` i64 at 8, `l_len` i64 at 16. `F_SETLK=6`, `F_OFD_SETLK=37`, `F_WRLCK=1`.
- The holder is `bun probe.ts hold-<posix|ofd|flock>-<none|sqlite> HOME &`, then `bun probe.ts check-<kind> HOME` and `sqlite-read`/`sqlite-write`.
- The SQLite variant runs `new Database(home)`, then `pragma locking_mode=exclusive`, `pragma journal_mode=wal`, then `begin immediate; insert; commit`.

## Not exercised / open

- **macOS arm64. Nothing here ran on a Mac.** On macOS these things would differ, or still need confirming:
  - `dlopen("/usr/lib/libSystem.B.dylib")`, errno through `__error()`, and `EWOULDBLOCK = 35` (Linux: 11). These are coded but never executed.
  - Confirm that `flock` on the companion doesn't disturb SQLite on the home. It should not: they are different inodes.
  - Optionally confirm that `flock` on the *home itself* gives `SQLITE_BUSY`. That is the reason for the companion.
  - macOS has no public `F_OFD_SETLK`. POSIX `fcntl` locks there have the same close-any-fd trap as probe B, and calling variadic `fcntl` through FFI on Apple arm64 puts the variadic args on the stack, so a fixed-arg FFI declaration is wrong.
  - Bun on macOS links the system SQLite, not its bundled copy.
  - Firmlinks (`/System/Volumes/Data/...` vs `/Users/...`) should converge because of the same-directory companion. Untested.
  - Run `bun test src/home/ownership.test.ts` on a Mac to close that criterion.
- **Network filesystems (NFS/SMB/FUSE) are unsupported** (DESIGN §4). They are not detected. On Linux NFS, `flock` is emulated with `fcntl` byte locks and is lease-based. Not tested.
- Bind mounts are untested. The "changed during acquisition" branch is untested.
- Other Linux libcs (musl's `libc.so`) are not handled. Windows is unsupported and the module throws.
- Locking is advisory. A process that ignores this module (the `sqlite3` CLI, a non-Horcrux tool) can still write the home (probe D/C "plain SQLite write OK"). This protects against a second Horcrux owner, not against arbitrary writers.
- The `-hxowner` companion name is not in `.gitignore`. Test homes live in the temp dir, so it doesn't matter yet. P0-06 or the coordinator should add `*-hxowner` next to `*-wal`.
- No ADR yet. `docs/decisions/` is outside this task's lane, so the ownership ADR is left to P0-06 / the coordinator, using the Decision section above.
