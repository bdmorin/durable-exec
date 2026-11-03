# P1-01 evidence: home schema, compatibility check, and migrations

**Platform: Linux only.** macOS arm64 has not been exercised. Nothing here is platform-specific beyond SQLite file I/O, but that is untested on a Mac.

| | |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS, kernel 6.18.44, x86_64 |
| Bun | 1.4.4 (38afee6c8); `node:sqlite` reports SQLite 3.53.4 |
| Node | v22.23.4 (not used) |
| Dependencies | unchanged: Chord 1.5.0 (facade, via P0-02's `openHomeDatabase`), pi-durable 1.5.0 (`SqliteStorage`, coexistence tests only). No new packages |
| Base | `llm/gifted-galileo-atanlf` at `f5e6922`; `bun install` from the committed lockfile |

## What was built

- [`src/home/schema.ts`](../../src/home/schema.ts): classification, the pre-open file check, and the runner.
- [`src/home/migrations/index.ts`](../../src/home/migrations/index.ts): the `Migration` type, the ordered registry `MIGRATIONS`, `validateMigrations`.
- [`src/home/migrations/0001-home-identity.ts`](../../src/home/migrations/0001-home-identity.ts): creates `hx_meta` and `hx_migrations`, and sets the SQLite header `application_id`.

### API (for P1-02 and later)

```ts
// Before openHomeDatabase. Writes nothing. Throws HomeFormatError, or returns the classification.
checkHomeFile(path, { create?: boolean }): Promise<HomeInspection>
inspectHomeFile(path): Promise<HomeInspection>   // same, never throws for a classifiable file (for status)

// After openHomeDatabase. Reads first, throws HomeFormatError before any write, then migrates.
prepareHome(db, { create?: boolean, appVersion: string }): Promise<{ homeId, formatVersion, created, applied: {id, name}[] }>
```

Intended composition: `acquireHomeOwnership(path)` → `checkHomeFile(path, { create })` → `openHomeDatabase(path)` → `prepareHome(db, { create, appVersion: VERSION })` → … → close → release. `appVersion` is passed in (P1-02 has `VERSION` in `src/cli/program.ts`), so this module depends on neither the CLI nor ownership.

`create` means "this caller may initialize": it accepts a missing path, a 0-byte file, an empty SQLite database, or one with only `pi_*` tables. Refusing to overwrite an existing path is `init`'s job (P1-02), not this one's.

`HomeFormatError.code` is one of `missing`, `not-a-file`, `not-sqlite`, `not-a-home`, `uninitialized`, `newer-format`, `inconsistent`. A failing migration throws `HomeMigrationError` with `migrationId`, `migrationName`, `formatVersion` (where the home was left) and `cause`.

### Schema

- `hx_meta(key TEXT PRIMARY KEY, value TEXT)`: `format = "horcrux-home"`, `home_id` (random UUID v4), `format_version`, `created_at`, `created_app_version`, `created_runtime` (e.g. `bun 1.4.4 linux-x64`), `created_sqlite_version`.
- `hx_migrations(id, name, applied_at, app_version, runtime)`: one row per applied migration, so the history also says which app and runtime did each step.
- `PRAGMA application_id = 0x48524358` ("HRCX") in the SQLite header.

**Frozen forever:** `hx_meta.format`, `hx_meta.format_version`, the `application_id` value, and the `hx_migrations(id, name)` columns. Older binaries read exactly these to refuse what they do not understand. Everything else may change through migrations.

**Format version** = id of the last migration applied. A home is `current` (equal to the registry length), `outdated` (migrations pending), or `newer` (higher than this binary knows). Opening a current home writes nothing (tested: `total_changes() = 0` and identical file bytes after reopen). The app version is recorded at creation and per migration, not on every open.

## Migration convention (P1-02..P1-04 and Phase 2, please follow)

1. One file per migration: `src/home/migrations/NNNN-<kebab-name>.ts`, exporting `migration: Migration` with `id: NNNN` and `name: "<kebab-name>"`.
2. Register it by appending one import and one array entry in `src/home/migrations/index.ts`. That is the only shared line.
3. Ids are explicit, start at 1, and are contiguous. If two branches both take the next id, **whoever merges second renumbers** their file and `id`. The resulting conflict in `index.ts` is two adjacent added lines; keep both. Renumbering is safe only because nothing has shipped. Once a migration is in a released binary, its id and name are permanent.
4. `up(tx, context)` gets the transaction handle only. Never call the database itself inside `up`, because it deadlocks (Chord contract). Never hold anything async-external inside it.
5. Touch only `hx_*` objects. The runner enforces this: it snapshots `sqlite_master` before and after `up`, and any object created, altered or dropped on a non-`hx_` table fails the migration and rolls it back. Pi owns `pi_*`.
6. No destructive data migration without an ADR.

Guards: [`src/home/migrations/index.test.ts`](../../src/home/migrations/index.test.ts) fails if a `NNNN-*.ts` file is unregistered, registered twice, out of order, or has an id/name/file-name mismatch. `validateMigrations` (run by `prepareHome`) rejects gaps, duplicate ids and duplicate names. A home whose recorded history names a different migration at some id (for example one built from an unmerged branch) is refused as `inconsistent`. It is not silently "upgraded".

## How "no write on newer or foreign homes" is proven

The facade itself writes on open for some files (probe, `scratch/`, since deleted):

| File | `openHomeDatabase` effect |
| --- | --- |
| foreign SQLite in rollback-journal mode | main-file bytes change (`journal_mode=WAL` rewrites header bytes 18–19) |
| 0-byte file | becomes a 4096-byte SQLite file |
| non-SQLite file | throws `file is not a database`, no write |
| WAL-mode Horcrux home | main bytes unchanged; `-wal`/`-shm` are created and removed again by `close()` |

So the refusal has to happen **before** `openHomeDatabase`. `checkHomeFile` does that without writing:

1. `stat` the path (missing / not a regular file / 0 bytes), then read the 16-byte header with plain `fs` I/O. No `SQLite format 3\0` → `not-sqlite`. No SQLite library touches the file.
2. For SQLite files: a `readOnly` `node:sqlite` connection. If there is no non-empty `-wal`, it uses the URI `file:…?immutable=1`. Probe: a plain read-only open of a closed WAL home **leaves `-wal` (0 B) and `-shm` (32 KiB) behind**, while `immutable=1` creates no companion files. If a hot WAL exists (a crashed owner), it must be read, so the URI is not `immutable`. SQLite may then add `-shm`, but the main file is not written. Ownership is acquired first, so no live writer exists in either case.
3. The same read-only `classify` runs again in `prepareHome` on the open facade, before its first write.

Test proof (`src/home/schema.test.ts`, "refusals write nothing"):

- **Newer home** (built with a real extra migration, then opened by a registry that lacks it): `checkHomeFile` throws `newer-format`. The SHA-256 of the main file is identical afterwards, and the directory still holds only `home.horcrux` (no `-wal`/`-shm`/`-journal`). Then on the facade: `prepareHome` throws `newer-format`, `SELECT total_changes()` is 0, and after `close()` the SHA-256 and the directory listing are unchanged.
- **Not a home:** text file, 6-byte stub, an SQLite magic followed by garbage (`not-sqlite`), a foreign SQLite DB in rollback-journal mode with a table, an SQLite DB with another `application_id`, and a P0-03-style file with only `hx_files` (`not-a-home`). Each one has an identical SHA-256 after `checkHomeFile(…, { create: true })`, and no companion file appears. A directory gives `not-a-file`.
- **Facade path, foreign DB:** `prepareHome(create: true)` refuses `not-a-home`, and the tables and `application_id` are unchanged.
- **Hot WAL:** with the writer still open, so every page is only in `-wal`, `inspectHomeFile` sees the newer format rather than the stale main file.
- Mutation check (manual, reverted): forcing `immutable=1` always makes the hot-WAL test fail. Dropping it always makes the newer-home test fail on the leftover companions. Removing the `newer` refusal makes the newer-home test fail.

**Telling "not a Horcrux home" from "newer Horcrux home":** a home is identified by `hx_meta.format = "horcrux-home"` (with `application_id` HRCX). A newer home still has both, because they are frozen, and only `format_version` exceeds the supported version. Anything else is `not-sqlite` (no SQLite header, or SQLite refuses it), `not-a-home` (foreign `application_id`, non-`hx_`/non-`pi_` tables, `hx_*` tables without `hx_meta`, or a different `hx_meta.format`), or `inconsistent` (Horcrux markers whose identity or history does not add up: header without `hx_meta`, missing `home_id`, bad `format_version`, a gap or divergence in `hx_migrations`).

## Transactions and rollback

Each pending migration runs in its own `db.transaction` (Chord: `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` behind the serial queue). The same transaction re-checks the current format version, runs `up(tx)`, applies the namespace guard, inserts the `hx_migrations` row and bumps `hx_meta.format_version`. Tests:

- `[m1, addTwo, failingThree]` on a v1 home: migration 3 creates a table, inserts into `hx_two`, then throws. Result: `HomeMigrationError {migrationId: 3, formatVersion: 2}`. `hx_three` is absent, `hx_two` holds only migration 2's row, `hx_migrations` = [1, 2], `format_version` = 2. Rerunning with a fixed migration 3 applies only 3.
- A failing migration 1 during init leaves zero tables **and `application_id` 0** (the header pragma is transactional). Init then succeeds.
- A migration that creates `pi_sneaky` alongside `hx_ok` is rolled back entirely.
- A non-contiguous registry is rejected before anything runs.

## Coexistence with pi-durable `SqliteStorage`

- **Home first:** `prepareHome(create)` → `SqliteStorage.open(db, { prefix: "pi_" })` → commit a Pi entry → close. Reopened **Pi first**: `SqliteStorage.open` → `prepareHome` returns the same `homeId` with nothing applied. The Pi entry reads back, the `pi_*` schema is unchanged across `prepareHome`, and the non-`pi_` tables are exactly `hx_meta`, `hx_migrations`.
- **Pi first on a fresh file:** Pi creates its tables and an entry. `prepareHome` without `create` refuses `uninitialized`; with `create` it initializes. The `pi_*` `sqlite_master` rows are identical before and after, and the Pi entry still reads, as does a new one. The closed file then inspects as `current`.

## `hx_files` decision

Migration 1 does **not** define `hx_files`. Phase 2 owns it and defines it in its own migration. The P0-03 stub (`src/workspace/sqlite-stub-env.ts`, `CREATE TABLE IF NOT EXISTS hx_files`) is left untouched. Consequences:

- P0-03 probe homes (stub `hx_files`, no `hx_meta`) are refused as `not-a-home`. They are throwaway; recreate them with `init`. This is tested.
- If anything runs the stub against a real home before Phase 2, the stub's `hx_files` will exist when Phase 2's migration arrives. Phase 2's migration must then handle a pre-existing stub table, for example by renaming or dropping it after checking that it is the stub shape. The simpler course is to keep the stub off real homes.

## Commands

```sh
bun test src/home/schema.test.ts src/home/migrations   # 15 pass, 0 fail
bun test                                               # 83 pass, 0 fail (9 files)
bun run typecheck                                      # tsc --noEmit, clean
```

Tests in this card: init identity and stable reopen; empty-file refusal; ordered migrations with partial failure; failing migration 1; namespace guard; non-contiguous registry; divergent history; newer home (file check and facade); hot WAL; six not-a-home files and a directory; facade refusal of a foreign DB; Pi coexistence in both orders; registry/file convention; registry validation.

## Not exercised

- **macOS arm64:** not run. In particular `immutable=1` and the read-only open behaviour on APFS are unverified.
- **A real crash.** The hot-WAL case is simulated by a still-open writer in the same process, not by a killed process.
- **CLI wiring and the compiled binary:** P1-02 composes these functions into `init`/open and exercises the binary. This card ran only under `bun test`.
- **Downgrade or repair tooling:** none. `inconsistent` and `newer-format` homes are refused, never modified.
- **Concurrent writers** without ownership. The per-migration version re-check inside the transaction catches a racing migrator, but exclusion is P0-04's job and was not combined here.
