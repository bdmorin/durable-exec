// Child process used by ownership.test.ts. Usage:
//   bun ownership.fixture.ts <home> <mode> [goFile]
// Modes:
//   try          acquire, report, release, exit
//   hold         acquire and keep ownership until killed
//   hold-sqlite  acquire, then open/write/close the home with bun:sqlite, keep ownership
//   hold-spawn   acquire, spawn a long-lived grandchild (pid reported), keep ownership
// If goFile is given, wait for it to exist before acquiring (start barrier).
// Prints exactly one status line: "OWNED <dev> <ino> [extra]" or "REFUSED <code>".
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { acquireHomeOwnership, HomeOwnershipError } from "./ownership.ts";

const [home, mode, goFile] = process.argv.slice(2) as [string, string, string | undefined];

if (goFile) while (!existsSync(goFile)) await Bun.sleep(1);

let handle;
try {
  handle = await acquireHomeOwnership(home);
} catch (e) {
  if (e instanceof HomeOwnershipError) {
    console.log(`REFUSED ${e.code}`);
    process.exit(0);
  }
  throw e;
}

let extra = "";
if (mode === "hold-sqlite") {
  const db = new Database(home);
  db.run("create table if not exists t(x)");
  db.run("insert into t values (1)");
  db.close();
  Bun.gc(true);
  extra = "sqlite-closed";
} else if (mode === "hold-spawn") {
  const child = Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] });
  child.unref();
  extra = `child=${child.pid}`;
}

console.log(`OWNED ${handle.dev} ${handle.ino}${extra ? " " + extra : ""}`);

if (mode === "try") {
  handle.release();
  process.exit(0);
}
setInterval(() => {}, 1 << 30);
