# P0-01 evidence: tooling baseline

- **Platform:** Linux x86_64 (cloud container), Bun 1.4.4, Node 22.23.4. macOS arm64 not exercised.
- **Pinned:** `@earendil-works/pi-durable` 1.5.0, `pi-ai` 1.5.0, `chord` 1.5.0, `commander` 15.0.0; dev: `typescript` 7.0.2, `@types/bun` 1.4.4. All exact versions; `bun.lock` committed.

## Commands

```bash
bun install
bun test              # 2 pass, 0 fail
bunx tsc --noEmit     # clean
bun run compile       # bundle 9 modules, compile dist/horcrux (~109 MB)
cd "$(mktemp -d)" && /path/to/dist/horcrux && ls -A   # help printed, directory still empty
```

## Findings

- Commander 15.0.0 parses, prints help, and reports unknown commands on stderr under Bun, both via `bun run` and the compiled binary. Its Node engine field was not relied on.
- `bun install` blocked two lifecycle scripts (`protobufjs` postinstall, `@google/genai` no-op preinstall), both transitive via `pi-ai`. Left blocked deliberately (no runtime/install-time scripts); nothing exercised so far needs them. Revisit if a provider SDK breaks.
- Chord ships `@earendil-works/chord/sqlite/node` (`NodeSqliteDatabase` over `node:sqlite`), and `node:sqlite` loads under Bun 1.4.4. That is the first reuse candidate for P0-02.
- `pi-durable` exposes `SqliteStorage.open(db: SqliteDatabase, { prefix })` and `./env` / `./env/node` subpaths for `ExecutionEnv`.

## Not exercised

- macOS arm64 compile; Pi storage inside the binary (P0-03); terminal renderer (P0-05).
