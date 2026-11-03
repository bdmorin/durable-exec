import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = join(import.meta.dir, "..", "main.ts");

test("bare invocation prints help to stdout, exits 0, and writes nothing to cwd", () => {
  const cwd = mkdtempSync(join(tmpdir(), "hx-help-"));
  const proc = Bun.spawnSync(["bun", entry], { cwd, env: { PATH: process.env.PATH ?? "" } });
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString()).toContain("Usage: horcrux");
  expect(proc.stderr.toString()).toBe("");
  expect(readdirSync(cwd)).toEqual([]);
});

test("unknown command fails on stderr, leaving stdout clean", () => {
  const proc = Bun.spawnSync(["bun", entry, "frobnicate"]);
  expect(proc.exitCode).not.toBe(0);
  expect(proc.stdout.toString()).toBe("");
  expect(proc.stderr.toString()).toContain("frobnicate");
});
