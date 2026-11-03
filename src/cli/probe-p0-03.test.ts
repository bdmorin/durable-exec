// P0-03: the COMPILED binary (not `bun run`) keeps app + Pi state and a Pi-tool-written file in one home across
// processes. Model turns are an OFFLINE FIXTURE (pi-ai faux provider); the workspace is the P0-03 stub env.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = join(import.meta.dir, "..", "main.ts");
const packageJson = join(import.meta.dir, "..", "..", "package.json");
// Bun's compiled executables autoload `.env` and `bunfig.toml` from the cwd by default, and a cwd `bunfig.toml` can
// `preload` arbitrary code (observed on Bun 1.4.4, see evidence/P0-03). The release build must turn both off.
const NO_AMBIENT_FLAGS = ["--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig"];
let root: string;
let binary: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hx-p0-03-bin-"));
  binary = join(root, "bin", "horcrux");
  const build = Bun.spawnSync(["bun", "build", entry, "--compile", ...NO_AMBIENT_FLAGS, "--outfile", binary]);
  if (build.exitCode !== 0) throw new Error(`compile failed: ${build.stderr.toString()}`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(phase: string, cwd: string, home: string) {
  // Minimal environment: no inherited variables, an empty HOME, and a cwd with no node_modules or checkout.
  const proc = Bun.spawnSync([binary, "probe-p0-03", phase, "home.horcrux"], {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: home },
  });
  expect(proc.stderr.toString()).toBe("");
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as {
    checks: Record<string, boolean>;
    after: { appRows: { phase: string }[]; transcript: { kind: string; text: string }[]; file: string };
  };
}

test("the release compile script disables cwd .env / bunfig.toml autoloading", () => {
  const script = (JSON.parse(readFileSync(packageJson, "utf8")) as { scripts: { compile: string } }).scripts.compile;
  for (const flag of NO_AMBIENT_FLAGS) expect(script).toContain(flag);
});

test("compiled binary: write turn, then a second process reopens app rows, transcript and file", () => {
  const cwd = mkdtempSync(join(root, "cwd-"));
  const home = mkdtempSync(join(root, "home-"));
  // A hostile cwd: none of this may be loaded or run.
  writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./evil.ts"]\n');
  writeFileSync(join(cwd, "evil.ts"), 'require("node:fs").writeFileSync("PRELOAD_RAN", "1");\n');
  writeFileSync(join(cwd, ".env"), "HORCRUX_HOME=/nonexistent/from-dotenv.horcrux\n");
  const ambient = [".env", "bunfig.toml", "evil.ts"];

  const first = run("write", cwd, home);
  expect(Object.values(first.checks).every(Boolean)).toBe(true);
  expect(readdirSync(cwd).sort()).toEqual([...ambient, "home.horcrux"]); // clean exit checkpoints WAL away

  const second = run("read", cwd, home);
  expect(second.checks).toEqual({
    turnDone: true,
    fixtureConsumed: true,
    fileWritten: true,
    writeToolResult: true,
    reopenedAppRow: true,
    reopenedTranscript: true,
    reopenedFile: true,
    readToolSawFile: true,
  });
  expect(second.after.appRows.map((row) => row.phase)).toEqual(["write", "read"]);
  expect(second.after.transcript.filter((line) => line.kind === "pi.tool-result").map((line) => line.text)).toEqual([
    "write: Successfully wrote to result.md",
    `read: ${second.after.file}`,
  ]);

  const third = run("inspect", cwd, home); // read-only harness
  expect(Object.values(third.checks).every(Boolean)).toBe(true);
  expect(third.after.transcript).toEqual(second.after.transcript);

  expect(existsSync(join(cwd, "PRELOAD_RAN"))).toBe(false);
  expect(readdirSync(cwd).sort()).toEqual([...ambient, "home.horcrux"]);
  expect(readdirSync(home)).toEqual([]); // nothing ambient written under HOME
}, 120_000);
