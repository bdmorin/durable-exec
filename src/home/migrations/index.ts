// The ordered registry of home schema migrations (P1-01).
//
// Convention (see evidence/P1-01/README.md, "Migration convention"):
// - One file per migration: `src/home/migrations/NNNN-<name>.ts`, exporting `migration` with `id: NNNN` and
//   `name: "<name>"`. Ids are explicit, start at 1, and are contiguous; the format version of a home is the id of
//   the last migration applied to it.
// - Append the import and the array entry below; nothing else. If two branches both claim the next id, whoever
//   merges second renumbers (file name + `id`) before merging. Renumbering is only safe while the migration has
//   never shipped, which is why ids are checked for contiguity and names are checked against applied history.
// - A migration only touches `hx_*` objects, through the transaction handle it is given. Never call the database
//   itself inside `up` (it deadlocks), never touch `pi_*` (Pi owns it), never drop or rewrite user data without an
//   ADR. The runner rejects (and rolls back) a migration that creates, alters or drops a non-`hx_` object.

import type { SqliteExecutor } from "../../db/home-database.ts";
import { migration as m0001 } from "./0001-home-identity.ts";

/** Facts about the running application, handed to every migration and recorded with it. */
export type MigrationContext = {
  /** Horcrux application version doing the migration. */
  readonly appVersion: string;
  /** Runtime description, e.g. `bun 1.4.4 linux-x64`. */
  readonly runtime: string;
  /** `sqlite_version()` of the connection. */
  readonly sqliteVersion: string;
  /** ISO-8601 timestamp shared by everything this migration records. */
  readonly now: string;
};

export type Migration = {
  /** Explicit, contiguous from 1. Equals the home format version once applied. */
  readonly id: number;
  /** Lowercase kebab-case; must match the file name after the `NNNN-` prefix. Recorded in `hx_migrations`. */
  readonly name: string;
  /** Runs inside one facade transaction. Use only `tx`. */
  up(tx: SqliteExecutor, context: MigrationContext): Promise<void>;
};

export const MIGRATIONS: readonly Migration[] = [m0001];

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Throws unless ids are exactly 1..n in order and names are unique kebab-case. */
export function validateMigrations(migrations: readonly Migration[]): void {
  const names = new Set<string>();
  migrations.forEach((migration, index) => {
    if (migration.id !== index + 1) {
      throw new Error(`migration ids must be contiguous from 1: position ${index + 1} has id ${migration.id}`);
    }
    if (!NAME.test(migration.name)) throw new Error(`migration ${migration.id} has an invalid name: ${migration.name}`);
    if (names.has(migration.name)) throw new Error(`duplicate migration name: ${migration.name}`);
    names.add(migration.name);
  });
}
