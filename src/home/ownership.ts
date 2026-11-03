/**
 * Single-owner exclusion for a Horcrux home file (DESIGN §4).
 *
 * Mechanism: a non-blocking exclusive flock(2) on a companion lock file
 * `<canonical home>-hxowner`, held for the life of the owning process.
 *
 * - The kernel drops the lock when the owner dies (any signal, including
 *   SIGKILL). There is no PID file, lease, or timeout, so a paused (SIGSTOP)
 *   owner keeps ownership.
 * - flock locks belong to the open file description, not the process, so the
 *   SQLite connection opening and closing the home cannot release it (the
 *   classic POSIX fcntl() trap). A second acquisition in the same process is
 *   refused like any other.
 * - The lock is on a companion, not on the home itself, because on macOS/BSD
 *   flock() and SQLite's fcntl() locks on the same file interact.
 * - Aliases: the companion path is derived from realpath(home), so symlinks,
 *   relative paths and `..` converge on one lock. Hardlinks cannot be
 *   canonicalised by path, so a home with more than one link is refused.
 *
 * Never delete the companion file: unlinking a held flock file lets a new
 * process lock a fresh inode under the same name. Network filesystems are
 * not supported. See evidence/P0-04/README.md.
 */
import { dlopen, FFIType, read, type Pointer } from "bun:ffi";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, statSync } from "node:fs";

export type HomeOwnershipErrorCode =
  | "owned" // another open lock holds the home
  | "missing" // the home does not exist (ownership never creates it)
  | "not-a-file" // the home is not a regular file
  | "hardlinked" // the home has more than one link, so aliases cannot be ruled out
  | "changed"; // the home or its lock file was replaced while acquiring

export class HomeOwnershipError extends Error {
  constructor(
    readonly code: HomeOwnershipErrorCode,
    readonly homePath: string,
    message: string,
  ) {
    super(message);
    this.name = "HomeOwnershipError";
  }
}

/** Refusal because a live process (possibly this one) already owns the home. */
export class HomeOwnedError extends HomeOwnershipError {
  constructor(homePath: string, readonly lockPath: string) {
    super("owned", homePath, `home is already owned by another process: ${homePath}`);
    this.name = "HomeOwnedError";
  }
}

export interface OwnershipHandle {
  /** realpath of the home at acquisition. */
  readonly canonicalPath: string;
  /** Identity of the home file at acquisition. */
  readonly dev: bigint;
  readonly ino: bigint;
  /** The companion file whose flock is the ownership. */
  readonly lockPath: string;
  /** Drop ownership. Idempotent. */
  release(): void;
}

export const LOCK_SUFFIX = "-hxowner";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

interface Libc {
  flock(fd: number, op: number): number;
  errno(): number;
  EWOULDBLOCK: number;
}

let libc: Libc | undefined;

function loadLibc(): Libc {
  if (libc) return libc;
  // flock(int, int) is not variadic, unlike fcntl(); calling a variadic C
  // function through FFI is not portable to Apple arm64.
  let path: string, errnoSym: string, EWOULDBLOCK: number;
  if (process.platform === "linux") [path, errnoSym, EWOULDBLOCK] = ["libc.so.6", "__errno_location", 11];
  else if (process.platform === "darwin") [path, errnoSym, EWOULDBLOCK] = ["/usr/lib/libSystem.B.dylib", "__error", 35];
  else throw new Error(`home ownership is not supported on ${process.platform}`);
  const { symbols } = dlopen(path, {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    [errnoSym]: { args: [], returns: FFIType.ptr },
  });
  const errnoPtr = symbols[errnoSym] as () => Pointer;
  libc = {
    flock: symbols.flock as (fd: number, op: number) => number,
    errno: () => read.i32(errnoPtr(), 0),
    EWOULDBLOCK,
  };
  return libc;
}

function canonicalHome(path: string): { real: string; dev: bigint; ino: bigint } {
  let real: string;
  try {
    real = realpathSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HomeOwnershipError("missing", path, `home does not exist: ${path}`);
    }
    throw e;
  }
  const st = statSync(real, { bigint: true });
  if (!st.isFile()) throw new HomeOwnershipError("not-a-file", path, `home is not a regular file: ${real}`);
  if (st.nlink !== 1n) {
    throw new HomeOwnershipError(
      "hardlinked",
      path,
      `home has ${st.nlink} hard links; ownership cannot rule out a second owner through another link: ${real}`,
    );
  }
  return { real, dev: st.dev, ino: st.ino };
}

/**
 * Become the single writable owner of the home at `path`, or throw.
 * Throws HomeOwnedError if another owner holds it; HomeOwnershipError for
 * homes that cannot be owned safely. Never waits and never creates the home.
 */
export async function acquireHomeOwnership(path: string): Promise<OwnershipHandle> {
  const { flock, errno, EWOULDBLOCK } = loadLibc();
  const home = canonicalHome(path);
  const lockPath = home.real + LOCK_SUFFIX;

  // O_NOFOLLOW: a planted symlink must not redirect the lock elsewhere.
  // Bun opens with O_CLOEXEC, so spawned children never inherit ownership.
  const fd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  let held = false;
  try {
    if (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      const err = errno();
      if (err === EWOULDBLOCK) throw new HomeOwnedError(path, lockPath);
      throw new Error(`flock(${lockPath}) failed: errno ${err}`);
    }
    held = true;

    // Re-validate after locking: the lock must still be the file at lockPath,
    // and the home must still be the same single-link inode.
    const locked = fstatSync(fd, { bigint: true });
    const named = lstatSync(lockPath, { bigint: true });
    const again = canonicalHome(path);
    if (named.ino !== locked.ino || named.dev !== locked.dev || again.real !== home.real ||
        again.dev !== home.dev || again.ino !== home.ino) {
      throw new HomeOwnershipError("changed", path, `home or its lock changed during acquisition: ${home.real}`);
    }
  } catch (e) {
    if (held) flock(fd, LOCK_UN);
    closeSync(fd);
    throw e;
  }

  let open = true;
  return {
    canonicalPath: home.real,
    dev: home.dev,
    ino: home.ino,
    lockPath,
    release() {
      if (!open) return;
      open = false;
      flock(fd, LOCK_UN);
      closeSync(fd);
    },
  };
}
