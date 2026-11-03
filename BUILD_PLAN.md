# Horcrux implementation handoff

Status: planning only. No listed application command is implemented yet. [DESIGN.md](DESIGN.md) is the behavioral contract; [README.md](README.md) is the entry point. Build the SQLite-native application, not the superseded Fossil integration.

## Baseline and engineering rules

- Work in TypeScript on Bun. Observed local Bun: 1.4.3; Node: 26.12.0.
- Pin pi-durable, pi-ai, and Chord to the exercised 1.5.0 family initially; do not use floating SDK versions. The published pi-durable package declares Node >=22.19.0, not an upstream promise of complete Bun compatibility.
- Commander 15.0.0 was the published version inspected during planning. Validate and pin the selected version under Bun rather than inheriting its Node engine declaration as compatibility proof.
- Use Bun's native HTTP server and embedded browser assets. Keep framework choices subordinate to the application contract. Select a TypeScript terminal renderer by exercising streaming, input, abort, non-TTY behavior, and compiled packaging before committing to it.
- Use SQLite directly with prepared statements and explicit migrations. Do not add an ORM, general plugin standard, distributed scheduler, or Fossil compatibility layer without a demonstrated requirement.
- Keep the application dependency graph explicit. No implicit home/project config loading, telemetry services, remote frontend assets, runtime package installation, or mandatory global daemon.
- Preserve the original handoff as historical context. Do not delete its evidence or implement its old architecture.

The first packaging/ownership proof targets the current macOS arm64 workstation. Record platform restrictions explicitly; do not advertise other platforms until exercised. The file format is intended to remain portable to compatible executables.

## Suggested source boundaries

These are implementation responsibilities, not files to create as empty scaffolds:

- `src/cli/`: argument routing, help, terminal/noninteractive behavior.
- `src/home/`: home selection, validation, migrations, ownership, configuration, snapshots.
- `src/db/`: shared SQLite executor, transaction queue, statement lifecycle.
- `src/workspace/`: persistent virtual filesystem and explicit host bindings/import/export.
- `src/agent/`: Pi registry/harness construction, configuration resolution, submissions, model binding.
- `src/application/`: operations shared by CLI, agent tools, and HTTP handlers.
- `src/telemetry/`: local operational records, diagnostics policy, retention, queries.
- `src/web/`: local API, authentication, snapshot/update streams, embedded browser client.
- `src/ecosystem/`: wiki, discussion, and application-inbox operations.

Keep SDK-specific adapters localized. Do not design a universal executor replacement interface or assume conversations/checkpoints can be moved between unrelated frameworks without migration.

## Reference project: borrow the lifecycle, not the product layout

Local checkout: `/Users/bdmorin/src/github.com/disler/durable-pi`.

| Reference | Useful behavior | Do not inherit automatically |
| --- | --- | --- |
| `apps/dpi-backend/src/store.ts` | Harness ownership, startup/reopen, stable request IDs, follow-up/steer policies, bounded waits | `~/.dpi`, catalog plus per-session databases, host cwd environments, PID-only ownership assumptions |
| `apps/dpi-backend/src/routes.ts` | Separate admission/status/abort/config commands from event viewers | Express dependency or device/session URL hierarchy |
| `apps/dpi-backend/src/streams.ts` | Fresh snapshot on reconnect, bounded buffering, disconnect detaches watchers | Connection sequence IDs as durable cursors |
| `apps/dpi-sdk/src/` | Shared client state/reducers and transcript rendering model | A separate distributed-device SDK before a local consumer needs it |
| `apps/dpi-playground/` | Browser interaction with an independently owned agent | Multi-device hub, registries, credential files, or remote deployment machinery |

Its pi-durable 1.0.3 API differs from our initial 1.5.0 baseline. Its offline provider is useful for deterministic continuity scenarios; it is not a substitute for a real provider smoke run.

## Phase 0: prove the risky runtime boundaries

Before substantial feature work:

1. Create the actual package/tooling setup with pinned dependencies and a lockfile; no empty application modules.
2. Build a minimal real Bun executable that opens Pi SQLite storage, persists and reopens application/Pi state, and invokes a genuine file tool through the intended environment boundary.
3. Exercise a queued shared-database facade with interleaved application/Pi operations and rollback after an awaited error. Reuse an existing compatible adapter where possible; do not wrap an async callback with Bun's synchronous `db.transaction()`.
4. Select the home-ownership mechanism. Exercise two concurrent processes, crash/reacquisition, and alternate paths to the same home. Exclusion must not expire under a merely paused owner; no unsafe stale-PID-file deletion copied from the reference.
5. Exercise the selected terminal library and a minimal bundled browser asset from the compiled binary. These are packaging gates, not a separate GUI implementation.

Exit gate: recorded commands/output establish which SQLite adapter, ownership mechanism, and terminal renderer the build uses. If a boundary fails, resolve it before building dependent features; do not silently change the single-home or continued-interaction contract.

## Phase 1: home and command lifecycle

Implement home creation/validation, schema compatibility and migrations, explicit selection, safe defaults, configuration commands, status, and the invocation journal. Establish `hx_` versus `pi_` ownership and the shared operation queue.

Acceptance:

- Running without a home prints useful help without creating a database or making a network request.
- `init FILE` creates a restrictive-permission home; accidental overwrite is refused.
- `--home` overrides `HORCRUX_HOME`; no directory scanning or implicit database creation occurs.
- A selected home records configured invocation metadata, including errors and dry-runs, without leaking credentials or arbitrary argument payloads.
- Status/config inspection does not activate the scheduler or invoke a model.
- A second writer is refused safely. Explicit remote/attach mode is a client, not another harness owner.
- Unsupported/newer schemas fail clearly without attempting destructive migration; failed migrations roll back.

## Phase 2: persistent workspace and resource policy

Implement the complete advertised Pi `ExecutionEnv` filesystem surface over SQLite, binary content, file revisions, race-free change observation, and explicit host imports/exports/bindings. Model directory/file conflicts and open-handle semantics deliberately.

Acceptance:

- Real Pi read/write/edit tools operate on database-backed content without extracting a working tree.
- Contents survive reopen; binary bytes, Unicode text, empty files, rename, and deletion behave correctly.
- Path traversal cannot escape the virtual root or enter a host binding without a grant. A missing virtual path never falls back to the host.
- Equal environment identities share the expected namespace and file-mutation serialization; unrelated workspaces remain isolated.
- Open readers observe the documented file/version across rename and replacement; directory paging and watchers do not miss committed changes.
- Shell execution is unavailable by default. Explicit host execution/import/export preserves its policy boundary, handles symlinks safely, and does not inherit unrestricted environment variables.
- SDK environment conformance checks cover the supported contract, supplemented by application isolation and persistence scenarios.

## Phase 3: configured agents and terminal interaction

Load configuration from the home, construct the pinned Pi harness/registry, resolve explicitly bound provider credentials, and implement interactive chat plus noninteractive submission/status. Retain Pi's native state model rather than copying transcript/task tables.

Acceptance:

- A real provider completes a tool-using turn with instructions and input files loaded from the VFS; the output file, transcript, run/configuration revision, and safe usage references persist.
- An empty-home-directory environment can reopen and inspect the home without credential discovery or network use.
- Missing credentials and denied provider endpoints fail explicitly. An API key alone does not enable a network capability.
- Subsequent turns use the retained conversation. Agent/configuration changes have documented next-request behavior and do not rewrite completed-run provenance.
- TUI supports live output, a follow-up, explicit abort, and clean terminal restoration. Noninteractive output contains no TUI/progress contamination.
- Reusing a request ID does not create a second submission, including an uncertain HTTP/CLI response boundary.
- Restart preserves completed work and accurately describes unfinished/uncertain operations. Inspection does not implicitly resume them.

Use the SDK's existing retry/checkpoint behavior where applicable; do not invent an exactly-once claim or add a separate replay engine.

## Phase 4: deterministic workflow and local observability

Implement a real deterministic file-import workflow with preview/dry-run and apply, sharing application operations with agent tools. This proves the executable is an application, not just a chat launcher. Add history/telemetry queries and retention controls.

Acceptance:

- The workflow is usable with no model credentials and makes no model request.
- Dry-run reports the proposed imports/changes without modifying its target or importing file contents. Its local activation metric remains policy-controlled.
- Apply makes the exact planned supported change, reports collisions/errors, and records source provenance and operation outcome.
- The agent can inspect the permitted operation history without seeing secrets or altering grants.
- Telemetry verbosity/retention changes do not delete required agent state. No tracing exporter, analytics, update check, or remote asset request is activated by inherited environment variables.

## Phase 5: local web interface and detachable clients

Implement `serve --web` inside the same Bun process, bundled assets, bearer-authenticated API, request-origin checks, and snapshot/update streaming. Add explicit CLI connection/authentication inputs for attaching to the owner.

Acceptance:

- A browser displays the actual persisted conversation, live tool/run activity, workspace, inbox, and local history.
- Close the browser during a running real turn: the owner and work continue. Reconnect and observe an authoritative current snapshot and subsequent updates.
- Send a follow-up or steer while busy; reject policy, queued input, and explicit abort have visible and correct outcomes.
- Disconnect a waiting HTTP client: admitted work is not cancelled. Reusing its request ID finds the original submission.
- Two viewers remain consistent; a slow viewer has bounded buffering and can reconnect without losing authoritative state.
- A reconnecting client's snapshot/update handoff does not miss a commit. The web client is not a second persistent database.
- Unauthenticated control/data access is denied. Untrusted browser origins cannot issue authorized control commands. Loopback is the default; external listening requires explicit authorization.
- Browser rendering is checked on the actual surface, including safe transcript rendering and a fresh launch. API-only smoke checks are not visual proof.

## Phase 6: the user ecosystem

Implement wiki pages, discussions, and an application inbox with links to agents, runs, and virtual content. Expose them through CLI commands, selected agent tools, and the same local web interface.

Acceptance:

- Page edits retain inspectable content revisions; discussions preserve ordered posts and their provenance.
- Inbox items have explicit pending/accepted/completed/dismissed transitions with recorded outcomes.
- Accepting an item admits work once under a stable request ID; retry/reconnect cannot create duplicate work.
- User and agent operations share the same authorization and application semantics. Imported text cannot enable tools, change grants, or become executable code.
- Records, links, and revisions survive snapshot/reopen without relying on the reference project's device catalog.

## Phase 7: portable executable and home

Exercise the complete program as a compiled executable, not only through Bun's development runner. Implement consistent snapshot output, clean lifecycle behavior, and compatible home migrations; document supported platforms and dependency limits.

Acceptance:

- Copy the executable and a closed home or explicit snapshot into a fresh directory with an empty application home environment. Status, configuration, conversations, virtual files, ecosystem records, and local history remain available.
- A live snapshot is internally consistent during active writes and opens independently. Do not copy only a live WAL main file.
- Clean-close/companion-file behavior is exercised on macOS; transient files are documented, not mislabeled as another application store.
- Machine-specific host resources require operator reauthorization on transfer. No stale path, token, or old network binding silently becomes active.
- The compiled application completes a real model/tool turn, a deterministic workflow, and browser disconnect/reconnect without a local source checkout or separately installed Node runtime.
- Retain the file-format and application operations documentation needed to inspect and migrate the home without historical context from this chat.

## Verification policy

Use permanent tests for plausible user-visible failures: transaction rollback/order, ownership exclusion, path/grant boundaries, lifecycle transitions, configuration precedence, duplicate admission, snapshot consistency, and retained state. Use the SDK conformance suites where appropriate. Do not add tests that merely repeat source text, copies, wiring, or incidental defaults.

For every significant feature, run the actual CLI or browser path in addition to tests. Use isolated temporary homes and explicit offline fixtures for deterministic scenarios. Identify offline-provider evidence as such. A real provider/tool turn is required before claiming the agent path complete; use an operator-approved credential binding and report if unavailable, never substitute a mock and claim success.

Do not run a test suite just to reconfirm a user-reported failure. Keep regressions focused on observable behavior. Remove throwaway scripts after their proof and retain their findings in the relevant implementation evidence.

Update design/usage documentation as decisions become exercised. A phase is complete only when its end-to-end behavior works; later phases are sequencing, not excuses to omit named requirements from the finished iteration.

## First implementation action

Start Phase 0 with the shared SQLite adapter and compiled Bun/Pi storage path. Prove awaited rollback and single-owner exclusion before building the workspace and chat on top. Keep the original Fossil runtime, native desktop GUI, multi-device networking, and agent-runtime rewrite out of that work.
