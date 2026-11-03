// Guards the one-file-per-migration convention against merge mistakes: two branches claiming the same id, a file
// added without its registry entry (or dropped from the registry by a conflict resolution), or a name/id mismatch.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { MIGRATIONS, type Migration, validateMigrations } from "./index.ts";

test("every NNNN-<name>.ts file is registered once, in id order, with matching id and name; ids are contiguous", async () => {
  const files = readdirSync(import.meta.dir)
    .filter((file) => /^\d{4}-.+\.ts$/.test(file) && !file.endsWith(".test.ts"))
    .sort();
  const fromFiles: Migration[] = [];
  for (const file of files) {
    const { migration } = (await import(`./${file}`)) as { migration: Migration };
    expect(`${String(migration.id).padStart(4, "0")}-${migration.name}.ts`).toBe(file);
    fromFiles.push(migration);
  }
  expect(MIGRATIONS).toEqual(fromFiles);
  expect(() => validateMigrations(MIGRATIONS)).not.toThrow();
});

test("validation rejects duplicate ids, gaps and duplicate names", () => {
  const m = (id: number, name: string): Migration => ({ id, name, up: async () => {} });
  expect(() => validateMigrations([m(1, "a"), m(1, "b")])).toThrow("contiguous");
  expect(() => validateMigrations([m(1, "a"), m(3, "b")])).toThrow("contiguous");
  expect(() => validateMigrations([m(2, "a")])).toThrow("contiguous");
  expect(() => validateMigrations([m(1, "a"), m(2, "a")])).toThrow("duplicate migration name");
  expect(() => validateMigrations([m(1, "Not Kebab")])).toThrow("invalid name");
});
