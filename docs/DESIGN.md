# Horcrux: the file is the system

Status: current design iteration, ready for implementation planning. No application has been implemented in this repository. This document supersedes the runtime architecture in [the original Fossil handoff](history/horcrux-durable-fossil-handoff.md).

## 1. Product contract

Horcrux is a local-first agent application with one authoritative SQLite home. A compatible executable opens that home and activates its configured agents, deterministic workflows, virtual workspace, and user-owned operational history.

The file contains the application's configuration and working continuity. The executable supplies Bun, application code, pi-durable, bundled tools, and interfaces. Model services, credentials supplied at launch, and explicitly granted host resources remain external dependencies. This is not a writable executable/database polyglot.

The system must:

- Behave like a normal CLI, with useful help and deterministic commands independent of a model.
- Run pi-durable directly inside Bun, without a separately managed Node service.
- Keep configuration, agent definitions, conversations, execution state, virtual files, knowledge, discussions, inbox records, and configured telemetry in the selected home.
- Expose chat through an interactive terminal interface and, when requested, a local web interface.
- Let clients disconnect and reconnect without owning or implicitly cancelling agent work.
- Provide explicit import/export and host-access operations; never discover or ingest the current directory merely because the program started there.
- Record useful local operational metadata by default when a home is selected. Never send telemetry to a vendor or automatically configure an exporter.
- Remain inspectable through SQLite, documented application commands, and versioned export formats.

State ownership is the goal. Automatic continuation of interrupted computation is useful existing pi-durable behavior, not a reason to invent a distributed workflow platform.

## 2. Decisions and boundaries

| Concern | Decision |
| --- | --- |
| Application runtime | Bun and TypeScript; Commander-style command routing |
| Agent execution | pi-durable, used as a library rather than forked initially |
| Persistent home | One application-owned SQLite database |
| Agent workspace | SQLite-backed virtual filesystem through a custom pi-durable `ExecutionEnv` |
| Host filesystem/process/network access | Explicit, policy-checked capabilities; no ambient agent access |
| Agent lifecycle | One owning application process per home; clients watch and submit commands |
| Web interface | Optional embedded browser assets and local HTTP API in the same executable |
| Native desktop GUI | Out of scope for this iteration |
| Fossil | Prior art for durable, inspectable application data and rich project features; no runtime dependency |
| SCM, Fossil artifact/protocol compatibility | Not a requirement; no branches, merges, or sync promised |
| Cloud services | Optional configured model/integration endpoints, not infrastructure prerequisites |

Wiki, discussions, and inbox remain part of the intended ecosystem. They are application features to implement over our schema, not features inherited automatically from SQLite or Fossil.

## 3. Authoritative state

Separate application-owned tables from SDK-owned tables. Use `hx_` for application tables and `pi_` for pi-durable's supported table prefix. Access Pi state through its APIs, never by editing its internal tables.

The initial logical model is:

| Records | Responsibility |
| --- | --- |
| `hx_meta`, `hx_migrations` | Home identity, format/application/runtime compatibility, migration history |
| `hx_settings`, `hx_agents` | Versioned application settings, agent definitions, Pi conversation references |
| `hx_workspaces`, `hx_files` | Workspace identity, paths, directory/file metadata, current content references |
| `hx_blobs`, `hx_file_versions` | Binary content and retained file revisions |
| `hx_grants` | Operator-managed resource permissions and their scopes |
| `hx_runs`, `hx_events` | Invocations, operation outcomes, user-facing operational events and metrics |
| `hx_pages` | Wiki/knowledge page identity and links to versioned content |
| `hx_threads`, `hx_posts` | Discussions and their relationship to agents, runs, and documents |
| `hx_inbox` | Application requests, notices, and actionable items |
| `pi_*` | SDK-managed conversations, submissions, transcript entries, documents, tasks, and usage |

These are logical responsibilities, not a frozen SQL schema. Define exact constraints and indexes while implementing their consumer-visible behavior. Treat Pi IDs as SDK-owned identifiers. Do not create a second authoritative copy of Pi transcripts, usage, or live-task state.

The application inbox is distinct from Pi's input queue. Accepting an inbox item can submit work with a stable request ID; it does not independently schedule or duplicate a Pi submission.

### Configuration

Persist agent instructions, model/provider selections, approved endpoint settings, extension/tool selections, workspace selection, limits, compaction policy, host grants, and telemetry policy. Pi's host-level settings are not all automatically persisted: the application loads them from the home and supplies them when constructing the harness.

Resolve defaults and configuration into a versioned run configuration. Record its revision with the run so subsequent edits do not change the historical meaning of that invocation. Reconcile persisted Pi agent choices through its public configuration APIs; do not maintain two competing configuration authorities.

Executable implementations are bundled and referenced by name/version. Storing an extension name or source document in the home does not authorize evaluating it as JavaScript. Arbitrary dynamically loaded code is not an initial feature.

## 4. Database ownership and transactions

Exactly one process owns a writable home and its Pi harness. All application and Pi operations use one coordinated database facade/operation queue. Other interfaces submit application commands to that owner. Reject a competing owner before opening a writable harness.

Ownership exclusion must survive process crashes without two live owners. Do not copy the reference project's PID-file implementation unquestioningly: stale-lock recovery, PID reuse, simultaneous acquisition, and aliases of the same home require deliberate handling. The implementation/packaging gate must choose and exercise a platform-supported exclusion mechanism. Transient lock metadata is operational state, not a second configuration store. Network filesystem ownership is not supported by the initial build.

Reuse pi-durable's portable `SqliteStorage`, rather than replacing its persistence semantics. Prefer an existing compatible database facade where it meets shared-connection requirements; otherwise adapt `bun:sqlite` behind the documented asynchronous `SqliteDatabase` interface.

Bun's native `db.transaction()` callback is synchronous. Never pass Pi's asynchronous transaction callback directly into it. A Bun adapter must explicitly manage begin/commit/rollback, serialize unrelated operations, and invalidate transaction handles after settlement. Never hold a database transaction across a model request or host subprocess.

One file does not imply one atomic operation across all layers. A VFS edit and Pi's later tool-result commit are separate unless deliberately integrated. Commit file changes with their application receipt, then allow the harness to record the tool result; use a stable operation identifier to recognize a completed mutation after an interrupted result publication. Specify behavior for an uncertain host effect instead of claiming external exactly-once execution.

## 5. Virtual workspace

A workspace is a persistent namespace, not a temporary extracted directory. Each run receives an environment selecting the appropriate workspace; repeated runs can reopen its contents. Separate agents can share a workspace deliberately, not accidentally.

Implement the filesystem surface required by Pi's file tools: path resolution, metadata, text/binary reads, positional readers, directory iteration, writes, append/truncate, directories, rename/remove, temporary virtual entries, cleanup, and change observation. Test the complete advertised surface, not a read/write-only substitute for `ExecutionEnv`.

Use POSIX-style logical paths independent of host OS. An illustrative layout is `/agent/instructions.md`, `/knowledge/policy.md`, and `/workspace/result.md`. Internal settings and grants are structured records, not agent-writable files. Internal temporary files can also live in the VFS.

Content blobs may be addressed by a documented content hash and shared by file revisions. Define binary-byte preservation, path normalization, directory conflicts, rename semantics, open-reader consistency, and revision retention explicitly. VFS reads must not fall through to the host filesystem when a path is absent.

### Host resources and shell execution

Host access is a separate capability, never a side effect of virtual path resolution. Operator-approved directory bindings can appear under an explicit namespace such as `/host/<grant-name>`. Binding a directory is not importing it; import makes a recorded copy into the home.

An ordinary host shell, Python interpreter, or PDF utility cannot see SQLite virtual files. Use an explicit supported bridge: input/output streams or selected-file export into a controlled working directory followed by explicit result import. Record provenance and clean up transient working data. Do not materialize the entire home silently.

Do not enable an unrestricted `bash` tool by default. The default environment reports shell execution unavailable; an explicitly enabled host execution tool has its own granted scope and environment. An enabled shell is powerful host access, not a confined substitute for database-native tools.

## 6. Startup, environment, and trust

The executable is provisionally named `horcrux`. Commands below define the intended interface, not existing commands.

Home selection is `--home FILE`, then the explicitly supported `HORCRUX_HOME` environment variable. Do not scan parent directories, infer a home from the current directory, or create a home implicitly. `init FILE` is the creation path. With no selected home, default help works without persistent writes; activation telemetry cannot be recorded without a destination. With a selected writable home, help and command activations follow its telemetry policy.

Precedence for supported non-security settings is explicit invocation override, then documented environment override, then home configuration, then application default. Overrides are invocation-local unless an explicit configuration command persists them. Record resolved non-secret settings and their sources.

Environment awareness is allowlisted: the home pointer, documented display hints, explicitly configured credential variable names, and supported invocation overrides. No automatic `.env`, home-directory config, project instructions, shell rc files, or runtime module downloads. Presence of an API key supplies a credential; it does not grant permission to make a network request.

Credentials are referenced by configured environment-variable bindings and resolved at launch; values are not copied into the home or logs by default. Do not pass the parent process's full environment to tools. A different machine can open and inspect a home without credentials; model/integration operations clearly report missing bindings.

The trusted application host enforces grants for file, process, provider, and integration operations. Prompts, imported documents, and model-selected tool arguments cannot grant access or modify the grant/configuration authority. Do not expose arbitrary SQL writes to the agent. A copied or untrusted home must not silently activate saved external grants: require explicit operator review/authorization before external access. Do not claim database-stored policy is a sandbox against malicious host plugins or a maliciously replaced executable.

Create homes with restrictive file permissions. Treat transcripts, documents, telemetry, and provider diagnostics as potentially sensitive even if credentials are excluded. Encryption is not implied by SQLite storage.

## 7. CLI and lifecycle contract

| Command family | Intended behavior |
| --- | --- |
| `horcrux` / `help` | Normal CLI help; no model activation |
| `init FILE` | Create a home with schema, explicit defaults, and no external grants |
| `--home FILE status` | Inspect agents, workspaces, runs, and required bindings without a model request |
| `--home FILE config ...` | Inspect or explicitly change structured configuration; redact secrets |
| `--home FILE run WORKFLOW ... --dry-run` | Deterministic workflow; no model required; dry-run does not change the target but may record local invocation metadata |
| `--home FILE chat [MESSAGE]` | Interactive TUI on a terminal; submit to a selected agent; provide an explicit noninteractive mode |
| `--home FILE serve --web` | Own the harness and expose the embedded local browser interface and API |
| `--home FILE fs ...` | Inspect/edit/export virtual files; import only with an explicit source and grant |
| `--home FILE history ...` / `telemetry ...` | Query recorded local state with machine-readable output options |
| `--home FILE wiki ...` / `discuss ...` / `inbox ...` | Manage ecosystem records through the same application operations used by tools and web clients |
| `--home FILE snapshot OUTPUT` | Produce a consistent portable home snapshot |

Use one application service layer for deterministic CLI calls, terminal chat, agent tools, and HTTP commands. Keep Commander and HTTP routing thin. Preserve stdout for requested command output; diagnostics go to stderr. Machine-readable output must not be mixed with progress rendering.

A direct CLI/TUI invocation may own the home for its lifetime. A long-lived `serve` process owns it while clients connect. A second CLI attaches through explicit connection/authentication options rather than opening a competing writable harness. Do not add a mandatory global daemon or implicit background service.

Client detach is not cancellation. Explicit abort affects the requested run; stopping the owner stops computation. Persisted state remains available when reopened. Opening a home for inspection must not start the Pi scheduler or send model requests. Admission of new work and explicit continuation are execution actions; their policy must account for existing unfinished work before starting the harness scheduler.

## 8. Web interface and continued interaction

Use `/Users/bdmorin/src/github.com/disler/durable-pi` as reference for process ownership and client interaction, not as the storage layout to copy.

The same Bun executable serves bundled browser assets, an authenticated command API, and an event stream. Bind to loopback by default. Non-loopback listening is an explicit, reviewed capability; production remote exposure/TLS/proxy operation is not required for the local build.

The owner admits messages with caller-provided stable request IDs and returns submission IDs. Support follow-up, steer, reject-while-busy, status, and explicit abort through Pi's APIs. Waiting HTTP requests and event streams are viewers: cancelling them must not cancel admitted work.

Use snapshot-then-update streaming. Every reconnect starts from a fresh authoritative snapshot; stream sequence numbers are connection-local, not durable replay cursors. Subscribe with a race-free snapshot handoff, bound slow-client buffering, and detach subscriptions on disconnect without closing the harness.

Protect data and control routes with bearer authentication. Use fetch-based browser streaming where headers are needed. Keep the local launch token in process/browser memory rather than a new home-directory config or persistent browser database. Static assets must not expose home data. Serve the UI locally without CDNs, analytics, or remote asset dependencies. Keep transcript HTML rendering safe and check request origins for browser-mediated control requests.

Browser state is a projection; SQLite remains authoritative. The initial interface needs agent selection, transcript/live activity, queued input, follow-up/steer, abort, workspace inspection, and local history/telemetry. It does not require the reference project's multi-device hub.

## 9. History, telemetry, and portability

Distinguish authoritative execution records from optional diagnostic telemetry. Turning off verbose telemetry must not remove the transcript, submitted work, or file state required for continuity. Default operational metadata includes invocation/run IDs, command kind, timestamps, outcome, and safe resource/usage references. Payload capture, full arguments, document contents, provider traffic, and detailed diagnostics require an explicit policy. Never dump the full environment.

Provide configurable retention and local queries. No telemetry beacon, automatic tracing exporter, update check, or remote asset fetch. Configured model and integration requests are intentional network use, not telemetry; record them as such. Review dependency/provider attribution behavior separately from telemetry.

Retain document/configuration revisions and execution provenance without claiming SCM, tamper-evident history, complete auditing, replication, or merge support.

SQLite WAL/journal/lock files may exist while the home is active; they are not separate authoritative application stores. Do not equate a raw copy of the live main file with a complete snapshot. Use a coordinated SQLite backup operation or equivalent validated snapshot path. Test clean close and companion-file behavior on the target platform. Copy/move a closed home or an explicit snapshot to a compatible executable; require reauthorization of machine-specific host resources.

## 10. Evidence and remaining proof

Observed in disposable probes during this design session:

- Fossil 2.28 `rebuild` removed an arbitrary added table; artifact reconstruction preserved a JSON checkpoint carried by a standard artifact but not an added table.
- Standard Fossil check-ins carried synthetic agent/run records through artifact reconstruction. No agent ran in that probe.
- Published pi-durable 1.5.0 under Node 26.12.0 wrote a typed state document; Bun 1.4.3 reopened the same conversation/state; Node reopened it again. This did not exercise models, tools, the VFS, or a compiled executable.
- Bun's native synchronous transaction wrapper around an async callback left rows committed after an awaited failure. This is the adapter pattern to avoid, not a product bug reproduction.
- The reference durable-pi backend, using its existing offline provider and temporary data, completed a pending response after an SSE client disconnected, returned a fresh reconnect snapshot, and accepted a follow-up in the same retained session after backend restart. Browser rendering and a real model were not exercised.

Still to prove in Horcrux: the complete VFS environment, shared transaction facade, single-owner exclusion, actual model/tool execution, CLI/TUI, local web surface, capability enforcement, consistent snapshot portability, and standalone packaging. The reference pins pi-durable 1.0.3, so its APIs cannot be transplanted blindly into the 1.5.0 baseline.

## 11. Source references

- [Pi-durable architecture, storage, settings, tools, and environment](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)
- [Pi execution environment contract](https://github.com/earendil-works/pi/blob/main/packages/durable/src/env/index.ts)
- [Shared asynchronous SQLite contract](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/database.ts)
- [Bun SQLite, transactions, and WAL behavior](https://bun.sh/docs/runtime/sqlite)
- [Bun standalone executable packaging](https://bun.sh/docs/compiler/executables)
- [SQLite consistent backup API](https://sqlite.org/backup.html)
- [Fossil enduring artifact format](https://fossil-scm.org/home/doc/trunk/www/fileformat.wiki)
- Local durable-pi: `apps/dpi-backend/src/store.ts`, `routes.ts`, `streams.ts`, and `apps/dpi-sdk/src/`; see [the build plan](BUILD_PLAN.md) for the implementation handoff.
