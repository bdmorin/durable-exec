// Exclusion is exercised with real, separate bun processes: ownership is a
// cross-process property and in-process tests cannot show kernel behavior.
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { openHomeDatabase } from "../db/home-database.ts";
import { acquireHomeOwnership, HomeOwnedError, HomeOwnershipError, LOCK_SUFFIX } from "./ownership.ts";

const FIXTURE = join(import.meta.dir, "ownership.fixture.ts");
const live: Bun.Subprocess[] = [];
const extraPids: number[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const p of live.splice(0)) {
    try { process.kill(p.pid, "SIGCONT"); } catch {}
    p.kill("SIGKILL");
  }
  for (const pid of extraPids.splice(0)) try { process.kill(pid, "SIGKILL"); } catch {}
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeHome(): { dir: string; home: string } {
  const dir = mkdtempSync(join(tmpdir(), "hx-own-"));
  dirs.push(dir);
  const home = join(dir, "home.horcrux");
  const db = new Database(home);
  db.run("pragma journal_mode=wal");
  db.run("create table t(x)");
  db.close();
  return { dir, home };
}

interface Child { proc: Bun.Subprocess<"ignore", "pipe", "inherit">; line: Promise<string> }

function start(home: string, mode: string, opts: { cwd?: string; go?: string } = {}): Child {
  const args = ["bun", FIXTURE, home, mode, ...(opts.go ? [opts.go] : [])];
  const proc = Bun.spawn(args, { cwd: opts.cwd, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  live.push(proc);
  const line = (async () => {
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      const nl = buf.indexOf("\n");
      if (nl >= 0) return buf.slice(0, nl);
    }
    throw new Error(`fixture exited (code ${await proc.exited}) without a status line: ${buf}`);
  })();
  return { proc, line };
}

const attempt = (home: string, cwd?: string) => start(home, "try", { cwd }).line;

async function hold(home: string, mode = "hold"): Promise<Child & { status: string }> {
  const c = start(home, mode);
  const status = await c.line;
  expect(status).toStartWith("OWNED ");
  return { ...c, status };
}

describe("cross-process exclusion", () => {
  test("racing acquirers produce exactly one owner; the rest are refused cleanly", async () => {
    const { dir, home } = makeHome();
    const go = join(dir, "go");
    const racers = Array.from({ length: 8 }, () => start(home, "hold", { go }));
    await Bun.sleep(300); // let every racer reach the barrier
    writeFileSync(go, "");
    const lines = await Promise.all(racers.map((r) => r.line));
    expect(lines.filter((l) => l.startsWith("OWNED ")).length).toBe(1);
    expect(lines.filter((l) => l === "REFUSED owned").length).toBe(7);
  }, 20_000);

  test("SIGKILLed owner: next acquire succeeds with no cleanup step", async () => {
    const { home } = makeHome();
    const owner = await hold(home);
    expect(await attempt(home)).toBe("REFUSED owned");
    owner.proc.kill("SIGKILL");
    await owner.proc.exited;
    expect(existsSync(home + LOCK_SUFFIX)).toBe(true); // stale companion left in place, harmlessly
    expect(await attempt(home)).toStartWith("OWNED ");
  }, 20_000);

  test("SIGSTOPped owner keeps ownership however long it is paused", async () => {
    const { home } = makeHome();
    const owner = await hold(home);
    owner.proc.kill("SIGSTOP");
    await Bun.sleep(1500);
    expect(await attempt(home)).toBe("REFUSED owned");
    owner.proc.kill("SIGCONT");
    expect(await attempt(home)).toBe("REFUSED owned");
  }, 20_000);

  test("owner opening and closing the home with SQLite does not drop ownership", async () => {
    // The POSIX fcntl() trap: closing any fd on a file drops the process's
    // fcntl locks on it. The owner writes through openHomeDatabase (node:sqlite)
    // and then bun:sqlite, closing both.
    const { home } = makeHome();
    const owner = await hold(home, "hold-sqlite");
    expect(owner.status).toEndWith("sqlite-closed");
    expect(await attempt(home)).toBe("REFUSED owned");
  }, 20_000);

  test("ownership and the home database facade coexist in the owner process without disturbing each other", async () => {
    const { home } = makeHome();
    const h = await acquireHomeOwnership(home); // ownership first, then the writable harness
    const db = await openHomeDatabase(home);
    try {
      await db.exec("CREATE TABLE hx_probe (n INTEGER)");
      await db.run("INSERT INTO hx_probe VALUES (1)");
      expect(await attempt(home)).toBe("REFUSED owned");

      // SQLite's own locks on the home survive the ownership machinery: while the
      // facade holds a write transaction, an outside writer gets SQLITE_BUSY.
      await db.transaction(async (tx) => {
        await tx.run("INSERT INTO hx_probe VALUES (2)");
        const outside = Bun.spawnSync(["bun", "-e",
          `const {DatabaseSync}=require("node:sqlite");` +
          `try{new DatabaseSync(${JSON.stringify(home)},{timeout:0}).exec("INSERT INTO hx_probe VALUES (99)");console.log("WROTE")}` +
          `catch(e){console.log(String(e.message))}`]);
        expect(outside.stdout.toString()).toContain("database is locked");
        expect(await attempt(home)).toBe("REFUSED owned");
      });
      expect(await db.all<{ n: number }>("SELECT n FROM hx_probe ORDER BY n")).toEqual([{ n: 1 }, { n: 2 }]);
    } finally {
      await db.close();
    }
    // closing the only connection to the home does not end ownership
    expect(await attempt(home)).toBe("REFUSED owned");
    h.release();
    expect(await attempt(home)).toStartWith("OWNED ");
  }, 20_000);

  test("a child spawned by the owner does not inherit ownership after the owner dies", async () => {
    const { home } = makeHome();
    const owner = await hold(home, "hold-spawn");
    const grandchild = Number(owner.status.match(/child=(\d+)/)![1]);
    extraPids.push(grandchild);
    owner.proc.kill("SIGKILL");
    await owner.proc.exited;
    expect(() => process.kill(grandchild, 0)).not.toThrow(); // still alive
    expect(await attempt(home)).toStartWith("OWNED ");
  }, 20_000);

  test("an explicit release lets another process acquire", async () => {
    const { home } = makeHome();
    const h = await acquireHomeOwnership(home);
    expect(await attempt(home)).toBe("REFUSED owned");
    h.release();
    h.release(); // idempotent
    expect(await attempt(home)).toStartWith("OWNED ");
  }, 20_000);
});

describe("aliases of one home cannot yield two owners", () => {
  test("symlink, symlinked directory, relative path and '..' segments are all refused", async () => {
    const { dir, home } = makeHome();
    const owner = await hold(home);
    const st = statSync(home, { bigint: true });
    expect(owner.status).toBe(`OWNED ${st.dev} ${st.ino}`);

    symlinkSync(home, join(dir, "link.horcrux"));
    symlinkSync(dir, join(dir, "dirlink"));
    mkdirSync(join(dir, "sub"));
    const elsewhere = mkdtempSync(join(tmpdir(), "hx-cwd-"));
    dirs.push(elsewhere);

    const aliases: [string, string | undefined][] = [
      [join(dir, "link.horcrux"), undefined],
      [join(dir, "dirlink", "home.horcrux"), undefined],
      [join(dir, "sub", "..", "home.horcrux"), undefined],
      [`${dir}//./home.horcrux`, undefined],
      ["home.horcrux", dir],
      [relative(elsewhere, home), elsewhere],
    ];
    for (const [alias, cwd] of aliases) {
      expect([alias, await attempt(alias, cwd)]).toEqual([alias, "REFUSED owned"]);
    }
  }, 30_000);

  test("a hardlinked home is refused through every name, before or after the link appears", async () => {
    const { dir, home } = makeHome();
    const owner = await hold(home);
    const link = join(dir, "hard.horcrux");
    linkSync(home, link); // created while owned
    expect(await attempt(link)).toBe("REFUSED hardlinked");
    owner.proc.kill("SIGKILL");
    await owner.proc.exited;
    // nobody owns it now, yet neither name can be acquired while two links exist
    expect(await attempt(home)).toBe("REFUSED hardlinked");
    expect(await attempt(link)).toBe("REFUSED hardlinked");
    rmSync(link);
    expect(await attempt(home)).toStartWith("OWNED ");
  }, 20_000);
});

describe("home identity edge cases", () => {
  test("a second acquire inside the owning process is refused too", async () => {
    const { home } = makeHome();
    const h = await acquireHomeOwnership(home);
    try {
      const err = await acquireHomeOwnership(home).catch((e) => e);
      expect(err).toBeInstanceOf(HomeOwnedError);
      expect(err.code).toBe("owned");
    } finally {
      h.release();
    }
  });

  test("a missing home is an error and nothing is created", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hx-own-"));
    dirs.push(dir);
    const home = join(dir, "absent.horcrux");
    const err = await acquireHomeOwnership(home).catch((e) => e);
    expect(err).toBeInstanceOf(HomeOwnershipError);
    expect(err.code).toBe("missing");
    expect(existsSync(home)).toBe(false);
    expect(existsSync(home + LOCK_SUFFIX)).toBe(false);
  });

  test("a directory is not a home", async () => {
    const { dir } = makeHome();
    const err = await acquireHomeOwnership(dir).catch((e) => e);
    expect(err.code).toBe("not-a-file");
  });

  test("replacing the home file while owned does not admit a second owner at that path", async () => {
    const { dir, home } = makeHome();
    await hold(home);
    const replacement = join(dir, "new.horcrux");
    writeFileSync(replacement, "");
    renameSync(replacement, home);
    expect(await attempt(home)).toBe("REFUSED owned");
    rmSync(home);
    expect(await attempt(home)).toBe("REFUSED missing");
  }, 20_000);
});
