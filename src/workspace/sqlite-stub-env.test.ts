// The P0-03 stub environment: what Pi's file tools rely on, the boundaries DESIGN §5 requires even of a stub, and the
// pi-durable env-conformance baseline it reaches (a Phase 2 starting point, not a target this stub tries to meet).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createEnvConformance } from "@earendil-works/pi-durable/testing";
import { openHomeDatabase } from "../db/home-database.ts";
import { openSqliteStubEnv } from "./sqlite-stub-env.ts";

const context = BACKGROUND_CONTEXT;
const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "hx-p0-03-env-"));
  dirs.push(dir);
  return join(dir, "home.horcrux");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStubEnv (P0-03 stub)", () => {
  test("bytes written survive closing and reopening the home", async () => {
    const home = tempHome();
    const bytes = Uint8Array.from([0, 255, 10, 0xe2, 0x82, 0xac]);
    const db = await openHomeDatabase(home);
    const env = await openSqliteStubEnv(db, { id: "t", cwd: "/workspace" });
    expect((await env.writeFile("a/b.bin", bytes, context)).ok).toBe(true);
    expect((await env.writeFile("/workspace/u.txt", "héllo\n", context)).ok).toBe(true);
    await db.close();

    const db2 = await openHomeDatabase(home);
    const env2 = await openSqliteStubEnv(db2, { id: "t", cwd: "/" });
    expect(await env2.readBinaryFile("/workspace/a/b.bin", context)).toEqual({ ok: true, value: bytes });
    expect(await env2.readTextFile("workspace/u.txt", context)).toEqual({ ok: true, value: "héllo\n" });
    const info = await env2.fileInfo("/workspace/a", context);
    expect(info.ok && info.value.kind).toBe("directory");
    await db2.close();
  });

  test("a missing path is not_found and never falls through to the host file system", async () => {
    const db = await openHomeDatabase(tempHome());
    const env = await openSqliteStubEnv(db, { id: "t" });
    // These exist on the host; the stub must not see them.
    for (const path of ["/etc/hostname", "/etc/passwd", "../../etc/passwd", import.meta.path]) {
      const read = await env.readTextFile(path, context);
      expect(read.ok ? "found" : read.error.code).toBe("not_found");
      expect(await env.exists(path, context)).toEqual({ ok: true, value: false });
    }
    // `..` cannot climb above the logical root.
    expect(await env.absolutePath("/workspace/../../../x", context)).toEqual({ ok: true, value: "/x" });
    await db.close();
  });

  test("file/directory conflicts are refused", async () => {
    const db = await openHomeDatabase(tempHome());
    const env = await openSqliteStubEnv(db, { id: "t" });
    expect((await env.writeFile("/d/f.txt", "x", context)).ok).toBe(true);
    const overDir = await env.writeFile("/d", "x", context);
    expect(overDir.ok ? "ok" : overDir.error.code).toBe("is_directory");
    const underFile = await env.writeFile("/d/f.txt/g", "x", context);
    expect(underFile.ok ? "ok" : underFile.error.code).toBe("not_directory");
    await db.close();
  });

  test("shell execution is unavailable", async () => {
    const db = await openHomeDatabase(tempHome());
    const env = await openSqliteStubEnv(db, { id: "t" });
    const result = await env.exec(["true"], undefined, context);
    expect(result.ok ? "ran" : result.error.code).toBe("shell_unavailable");
    await db.close();
  });
});

// Baseline, recorded in evidence/P0-03. A change here means the stub's coverage moved: update the evidence with it.
const EXPECTED_CONFORMANCE_PASSES = [
  "binary reader reads byte ranges of the opened file",
  "binary reader scans lines like decoding the whole file",
];

test("env-conformance baseline for the stub (Phase 2 starting point)", async () => {
  const cases = createEnvConformance({
    assertions: {
      ok: (value, message) => expect(value, message).toBeTruthy(),
      strictEqual: (actual, expected) => expect(actual).toBe(expected),
      deepEqual: (actual, expected) => expect(actual).toEqual(expected),
      partialDeepEqual: (actual, expected) => expect(actual).toMatchObject(expected as object),
      greaterThan: (actual, expected) => expect(actual).toBeGreaterThan(expected),
      rejects: async (operation, messageIncludes) => {
        await expect(operation).rejects.toThrow(messageIncludes);
      },
    },
    withEnv: async (use) => {
      const db = await openHomeDatabase(tempHome());
      try {
        await use(await openSqliteStubEnv(db, { id: "conformance", cwd: "/work" }));
      } finally {
        await db.close();
      }
    },
    symlinks: false,
  });
  const passed: string[] = [];
  const failed: string[] = [];
  for (const conformanceCase of cases) {
    try {
      await conformanceCase.run();
      passed.push(conformanceCase.name);
    } catch (error) {
      failed.push(`${conformanceCase.name} -- ${String(error).split("\n")[0]}`);
    }
  }
  if (process.env.HX_PRINT_CONFORMANCE) console.log(JSON.stringify({ total: cases.length, passed, failed }, null, 2));
  expect(passed.sort()).toEqual(EXPECTED_CONFORMANCE_PASSES);
}, 60_000);
