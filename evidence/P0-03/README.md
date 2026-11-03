# P0-03 evidence: compiled binary reopens Pi storage and runs a real Pi file tool

- **Platform:** Linux x86_64 (cloud container, kernel 6.18), Bun 1.4.4. Node not used at runtime. **macOS arm64 (the target) not exercised.**
- **Packages:** `@earendil-works/pi-durable` 1.5.0, `pi-ai` 1.5.0, `chord` 1.5.0. No dependency added.
- **SQLite:** `node:sqlite` via `openHomeDatabase` (P0-02), WAL, `synchronous=FULL`.
- **Model: OFFLINE FIXTURE.** pi-ai's faux provider (`@earendil-works/pi-ai/providers/faux`) registered as provider `hx-offline-fixture`, model `scripted`, with scripted responses. No network request, no credentials. This is **not** a real-provider proof.
- **Workspace: STUB.** `SqliteStubEnv` (`src/workspace/sqlite-stub-env.ts`), a minimal SQLite-backed `ExecutionEnv` over an `hx_files` table. **Not** the Phase 2 VFS.

## Result

Closes for **Linux x86_64 only**:

- A compiled binary (`bun build --compile`, not `bun run`) writes `hx_*` app rows and pi-durable state (`pi_*`) into one home file, exits, and later invocations reopen and read both.
- A genuine pi-durable file tool (`createWriteTool()`, then `createReadTool()` from `@earendil-works/pi-durable/tools`) runs inside a real Harness turn against the stub environment. The file it writes lives in the same home and is read back by a second process, both through the env API and through Pi's own `read` tool.
- No model request. The turn is driven by an offline fixture, labeled as such in code, output, and here.

The macOS arm64 criterion stays open.

## Pi API path used (public API only)

```ts
const db = await openHomeDatabase(home);                              // shared facade (P0-02)
await db.exec("CREATE TABLE IF NOT EXISTS hx_probe_runs (...)");      // app table
const env = await openSqliteStubEnv(db, { id: "hx-stub:p0-03", cwd: "/workspace" });
const storage = await SqliteStorage.open(db, { prefix: "pi_" });      // @earendil-works/pi-durable/storage/sqlite
const faux = fauxProvider({ provider: "hx-offline-fixture", models: [{ id: "scripted" }] });
const models = createModels(); models.setProvider(faux.provider);     // @earendil-works/pi-ai/models
const files = defineExtension({ name: "hx-p0-03-files", tools: [createWriteTool(), createReadTool()] });
const registry = createRegistry(); registry.install(files);
const harness = await Harness.open(storage, { models, registry, env: () => env, readOnly }, ctx);
const root = await harness.root(ctx, { agent: { model, extensions: [files], cwd: "/workspace" } }); // first run only
faux.setResponses([fauxAssistantMessage(fauxToolCall("write", {...}), { stopReason: "toolUse" }), fauxAssistantMessage("...")]);
const settled = await (await root.submit({ type: "input", content, requestId }, ctx)).wait(ctx);
const page = await root.entries({ order: "ascending" }, 500, undefined, ctx);  // transcript readback
await harness.close(ctx);   // closes SqliteStorage, which closes the shared facade: last
```

Pi state is read only through `Conversation.entries()`. The `sqlite3` listing below only shows table names.

## Where the code is

- `src/workspace/sqlite-stub-env.ts`: the stub env (permanent candidate; Phase 2 replaces it).
- `src/cli/probe-p0-03.ts`: the probe, a **hidden** subcommand `horcrux probe-p0-03 <write|read|inspect> <home>`, marked PHASE 0 PROBE. It is lazily imported, so help and other paths never load Pi. It does not show in `--help`. Remove it once Phase 1/2 commands exercise this path.
- `src/cli/probe-p0-03.test.ts`: compiles the binary into a temp dir and spawns it three times with `env: { PATH, HOME: <empty dir> }` from an empty, hostile cwd.
- `src/workspace/sqlite-stub-env.test.ts`: stub behavior plus the env-conformance baseline.
- `package.json` `compile` script: **changed**, see the trap below.

Phases: `write` runs a turn whose fixture calls `write(result.md)`, then inserts an `hx_probe_runs` row that references the Pi conversation/submission ids. `read` first reads back everything the earlier process left, then runs a turn whose fixture calls `read(result.md)`. `inspect` opens the Harness `readOnly: true` and only reads. Each prints a JSON report with `checks` and exits 1 if any check is false.

## Commands

```bash
bun install
bun run typecheck          # clean
bun test                   # 52 pass, 0 fail (5 files)
bun run compile            # bundle 172 modules, dist/horcrux ~110 MB

# manual run: binary copied into an empty temp dir, minimal environment
RUN=$(mktemp -d); FAKEHOME=$(mktemp -d); cp dist/horcrux "$RUN/"; cd "$RUN"
for p in write read inspect; do
  env -i PATH=/usr/bin:/bin HOME="$FAKEHOME" ./horcrux probe-p0-03 $p ./home.horcrux > $p.json; echo "$p exit=$?"; ls -A
done
ls -A "$FAKEHOME"          # empty
```

Output (trimmed):

```
ls before: horcrux
write exit=0     ls: home.horcrux horcrux write.json                         <- no -wal/-shm after clean exit
read exit=0      ls: home.horcrux horcrux read.json write.json
inspect exit=0   ls: home.horcrux horcrux inspect.json read.json write.json
fake HOME contents: (empty)

write   linux-x64 bun 1.4.4 submission {id: 8, status: done}
        checks {turnDone, fixtureConsumed, fileWritten, writeToolResult: all true}
read    linux-x64 bun 1.4.4 submission {id: 17, status: done}
        checks {turnDone, fixtureConsumed, fileWritten, writeToolResult,
                reopenedAppRow, reopenedTranscript, reopenedFile, readToolSawFile: all true}
inspect (readOnly harness) checks {fileWritten, writeToolResult, reopenedAppRow, reopenedTranscript,
                reopenedFile, readToolSawFile: all true}
```

The second process's readback, taken **before** it ran its own turn (`read.json` → `before`):

```
appRows  [{"id":1,"phase":"write","pi_conversation":1,"pi_submission":8}]
file     "# P0-03\n\nWritten by pi-durable's write tool into hx_files.\n"
transcript
  {"id":7,  "kind":"pi.user",        "text":"P0-03 write turn"}
  {"id":10, "kind":"pi.system",      "text":"(system: tools/prompt change)"}
  {"id":11, "kind":"pi.assistant",   "text":"toolCall write({\"path\":\"result.md\",\"content\":\"# P0-03\\n\\n...\"})"}
  {"id":13, "kind":"pi.tool-result", "text":"write: Successfully wrote to result.md"}
  {"id":15, "kind":"pi.assistant",   "text":"Wrote result.md."}
```

Then its own turn, in which Pi's `read` tool returns the file the first process wrote:

```
  {"id":16, "kind":"pi.user",        "text":"P0-03 read turn"}
  {"id":19, "kind":"pi.assistant",   "text":"toolCall read({\"path\":\"result.md\"})"}
  {"id":21, "kind":"pi.tool-result", "text":"read: # P0-03\n\nWritten by pi-durable's write tool into hx_files.\n"}
  {"id":23, "kind":"pi.assistant",   "text":"Read result.md."}
appRows  [... ,{"id":2,"phase":"read","pi_conversation":1,"pi_submission":17}]
```

Tables in the one file (Python `sqlite3`, `mode=ro&immutable=1`, names only):

```
hx_files hx_probe_runs pi_conversations pi_document_revisions pi_documents pi_durable_metadata
pi_durable_schema pi_entries pi_record_ids pi_submissions pi_tasks
```

### No network, no ambient files (strace)

`env -i PATH=/usr/bin:/bin HOME=<empty> strace -f -e trace=socket,connect,openat,open ./horcrux probe-p0-03 <phase> ./home.horcrux`, with the release compile flags:

```
write: socket/connect calls: 0
       paths opened (excl. /proc /sys /dev, libc/ld): /etc/localtime, <run dir>, home.horcrux,
       home.horcrux-journal (pre-WAL creation), home.horcrux-shm, home.horcrux-wal
read:  socket/connect calls: 0
       paths opened: /etc/localtime, <run dir>, home.horcrux, home.horcrux-shm, home.horcrux-wal
```

No `node_modules`, checkout, `~/.config`, or `.env` is opened.

### -wal / -shm

They exist while the binary runs and are gone after every clean exit (`harness.close` → `SqliteStorage.close` → facade `close()` → `wal_checkpoint(TRUNCATE)`). The directory then holds only `home.horcrux`. Exit after a crash or kill was **not** exercised. Note that inspecting the file with Python's `sqlite3` in plain `mode=ro` leaves `-wal`/`-shm` behind; use `immutable=1`, or open read-write.

## Trap found: compiled Bun binaries load `.env` and `bunfig.toml` from the cwd by default

On Bun 1.4.4, `bun build --compile` defaults to `--compile-autoload-dotenv` **and** `--compile-autoload-bunfig` (`bun build --help`). The P0-01 `compile` script used the defaults. The first strace showed `openat(AT_FDCWD, "bunfig.toml") = ENOENT` on every run. Scratch probes (since deleted), run from a cwd under the user's control:

```
default build, cwd .env "HX_DOTENV_PROBE=from-cwd-dotenv"  -> {"dotenv":"from-cwd-dotenv"}   (env injected)
default build, cwd bunfig.toml 'preload = ["./evil.ts"]'   -> "EVIL PRELOAD RAN"             (arbitrary code runs)
--no-compile-autoload-dotenv --no-compile-autoload-bunfig  -> {"dotenv":null}, no preload, no bunfig.toml open
```

This breaks AGENTS "no ambient `.env`", and worse, running `horcrux` inside a hostile directory executes that directory's code. **Fix (outside my lane, needed):** `package.json` `compile` now passes `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. `tsconfig`/`package.json` autoload already default to off. `probe-p0-03.test.ts` checks that the script carries both flags. It also runs the compiled binary from a cwd holding a preloading `bunfig.toml`, an `evil.ts`, and a `.env`, and asserts the preload never ran. Negative control: with the flags removed from the test's build, it fails with `PRELOAD_RAN` present in the cwd.

## Stub env shape

`SqliteStubEnv implements ExecutionEnv`. `hx_files(path TEXT PRIMARY KEY, content BLOB, mtime_ms INTEGER) STRICT`, created `IF NOT EXISTS` by `openSqliteStubEnv(db, { id, cwd })`. All access goes through the shared facade.

- **Implemented:** `absolutePath`/`joinPath` (logical POSIX, `..` clamps at `/`), `canonicalPath`, `exists`, `fileInfo`, `readTextFile`, `readBinaryFile`, `readTextLines`, `writeFile` (upsert; refuses writing over an implied directory with `is_directory` and under a file with `not_directory`), and `openBinaryReader` (a snapshot at open, so it keeps reading the file it opened; `scanLines` uses Pi's exported `LineScanner`). That is everything `read`, `write`, and `edit` call.
- **Directories** exist only as `/` or as a prefix of a stored file. `createDir` is not supported.
- **`not_supported`:** `openTextLineReader`, `appendFile`, `truncateFile`, `flushFile`, `renameFile`, `listDir`, `openDirReader`, `watch`, `createDir`, `remove`, `createTempDir`, `createTempFile`.
- **`exec`** always returns `ExecutionError("shell_unavailable")`.
- **Missing path** returns `not_found`, and never reaches the host. A test reads `/etc/passwd`, `/etc/hostname`, `../../etc/passwd`, and the test's own host path, and gets `not_found` for each.
- `hx_files` reuses the DESIGN §3 name but is **not** its schema. Phase 2 defines the real one (workspaces, blobs, revisions). Homes written by this stub are throwaway.

## Env-conformance baseline (Phase 2 starting point)

`createEnvConformance` from `@earendil-works/pi-durable/testing`, with `symlinks: false` and `listFiles: false`. Each case gets a fresh temp home with `cwd: "/work"`. **2 of 22 pass.** The test pins this list, so any change in coverage shows up.

| Result | Cases |
| --- | --- |
| pass (2) | binary reader reads byte ranges of the opened file; binary reader scans lines like decoding the whole file |
| fail: `renameFile` not supported (1) | binary reader keeps reading the file it opened after a rename |
| fail: `createDir` not supported (8) | binary reader refuses directories, missing files and aborted opens; directory reader pages every entry exactly once; directory reader reports the end and refuses use after close; directory reader skips entries removed during enumeration; watch follows directories created together with their contents; watch skips excluded entries and reports a rename out of them; argv exec honors cwd and exit codes; (plus `directory reader refuses missing paths and files`, which fails an assertion because `openDirReader` returns `not_supported`, not `not_found`) |
| fail: `watch` not supported (6) | watch reports a missing file's creation, changes, replacement and removal; watch reports a missing target whose ancestors are created; watch keeps watching a path whose parent is renamed and recreated; watch keeps recursive coverage where a non-recursive target overlaps; watch follows a directory replaced at the same path; watch stops reporting once stopped |
| fail: shell unavailable (5) | argv exec passes arguments without shell parsing; exec reports the stream of every chunk; windowed exec keeps the exact tail; argv exec reports missing programs and empty argv as spawn errors; argv exec distinguishes timeout from abort |

Note for Phase 2: 6 of the 22 cases exercise `exec` (argv or `sh -c`), and the 3 symlink cases skipped here (`symlinks: false`) create links with `ln -s` through it. Under DESIGN §5's "shell unavailable by default", those cases have to be run against an explicitly enabled host-execution env, or declared out of contract. Decide this deliberately rather than reading "conformance passes" as all 22 cases.

## Other observations

- `write` and `read` submit with `requestId: "p0-03-<phase>"`, so re-running a phase on the same home re-finds the original submission (Pi's idempotent admission) and does not run a second turn. The probe then reports `fixtureConsumed: false` and exits 1. That is expected; use a fresh home for each sequence.
- The faux provider's `api` id is random per process (`faux:<ts>:<rand>`). The agent's stored model ref is `{ provider, modelId }`, so reopen resolves through `models` regardless.
- `harness.root(ctx, { agent })` applies `agent` only when it creates the root conversation. Later runs call `root(ctx, {})` and must install the same extension *name* in the registry, because `pi.agent` stores extension names, not code.
- The compiled binary grew from about 109 MB (P0-01) to 110 MB; the bundle grew from 9 to 172 modules once Pi, pi-ai, and the faux provider are included.

## Not exercised

- **macOS arm64**, both compiled and `bun test`. The card's macOS criterion stays open.
- A real provider turn: everything here is an **offline fixture**.
- The Phase 2 VFS: directories, rename, remove, append, watch, revisions, binary/Unicode edge cases beyond one round-trip test, open-reader semantics under concurrent writes, and per-workspace isolation.
- Pi's `edit` and `bash` tools inside a turn. `edit` only uses methods the stub implements, but it was not run.
- Crash or kill mid-turn: `-wal` recovery, and Pi task recovery or `resume()` after an interrupted tool.
- Two processes on one home (P0-04).
- DESIGN §4's VFS-receipt / tool-result atomicity. Here the `hx_files` write and Pi's tool-result commit are separate commits on the same facade, with no stable operation id linking them.
