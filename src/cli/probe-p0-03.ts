// PHASE 0 PROBE (P0-03). Not a product command: it is hidden from help and exists so the COMPILED binary can prove
// that one home file holds `hx_*` app state and pi-durable state, that a genuine Pi file tool runs against a
// SQLite-backed environment, and that a later process reopens all of it. Remove or replace it once Phase 1/2 commands
// exercise the same path.
//
// OFFLINE FIXTURE: the model is pi-ai's faux provider with scripted responses. No network request, no credentials.
// This proves storage, harness, and tool plumbing; it says nothing about a real provider.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { type Conversation, createRegistry, defineExtension, Harness } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";
import { type HomeDatabase, openHomeDatabase } from "../db/home-database.ts";
import { openSqliteStubEnv, type SqliteStubEnv } from "../workspace/sqlite-stub-env.ts";

export type ProbePhase = "write" | "read" | "inspect";

const context: Context = BACKGROUND_CONTEXT;
const FIXTURE_PROVIDER = "hx-offline-fixture";
const FIXTURE_MODEL = "scripted";
const WORKSPACE = "/workspace";
const FILE = "result.md";
export const PROBE_FILE_CONTENT = "# P0-03\n\nWritten by pi-durable's write tool into hx_files.\n";

const filesExtension = defineExtension({ name: "hx-p0-03-files", tools: [createWriteTool(), createReadTool()] });

type TranscriptLine = { id: number; kind: string; text: string };

function summarize(entry: { id: number; kind: string; model?: readonly unknown[] }): TranscriptLine {
  const message = entry.model?.[0] as
    | { role?: string; content?: unknown; toolName?: string; isError?: boolean }
    | undefined;
  const blocks = Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];
  const parts = typeof message?.content === "string" ? [message.content] : [];
  for (const block of blocks) {
    if (block.type === "text") parts.push(String(block.text));
    if (block.type === "toolCall") parts.push(`toolCall ${String(block.name)}(${JSON.stringify(block.arguments)})`);
  }
  if (entry.kind === "pi.system") parts.splice(0, parts.length, "(system: tools/prompt change)");
  const prefix = message?.toolName ? `${message.toolName}${message.isError ? " ERROR" : ""}: ` : "";
  return { id: entry.id, kind: entry.kind, text: prefix + parts.join(" | ") };
}

async function transcript(root: Conversation): Promise<TranscriptLine[]> {
  const page = await root.entries({ order: "ascending" }, 500, undefined, context);
  return page.items.map(summarize);
}

async function appRows(db: HomeDatabase) {
  return db.all<{ id: number; phase: string; pi_conversation: number | null; pi_submission: number | null }>(
    "SELECT id, phase, pi_conversation, pi_submission FROM hx_probe_runs ORDER BY id",
  );
}

/** Run one probe phase against `homePath`, print a JSON report, and return whether every check held. */
export async function runP0_03Probe(phase: ProbePhase, homePath: string): Promise<boolean> {
  const db = await openHomeDatabase(homePath);
  let env: SqliteStubEnv;
  let storage: SqliteStorage | undefined;
  let harness: Harness | undefined;
  try {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS hx_probe_runs (
         id INTEGER PRIMARY KEY,
         phase TEXT NOT NULL,
         pi_conversation INTEGER,
         pi_submission INTEGER,
         at_ms INTEGER NOT NULL
       ) STRICT`,
    );
    env = await openSqliteStubEnv(db, { id: "hx-stub:p0-03", cwd: WORKSPACE });
    storage = await SqliteStorage.open(db, { prefix: "pi_" });

    const faux = fauxProvider({ provider: FIXTURE_PROVIDER, models: [{ id: FIXTURE_MODEL }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(filesExtension);
    harness = await Harness.open(
      storage,
      { models, registry, env: () => env, readOnly: phase === "inspect" },
      context,
    );
    const root = await harness.root(
      context,
      phase === "write"
        ? {
            agent: {
              model: { provider: FIXTURE_PROVIDER, modelId: FIXTURE_MODEL },
              extensions: [filesExtension],
              cwd: WORKSPACE,
            },
          }
        : {},
    );

    const before = {
      appRows: await appRows(db),
      transcript: await transcript(root),
      file: await env.readTextFile(`${WORKSPACE}/${FILE}`, context),
    };
    const report: Record<string, unknown> = {
      phase,
      bun: Bun.version,
      platform: `${process.platform}-${process.arch}`,
      model: "OFFLINE FIXTURE (pi-ai faux provider, scripted; no network, no credentials)",
      env: `STUB SqliteStubEnv id=${env.id} cwd=${env.cwd} (hx_files; not the Phase 2 VFS)`,
      before: { ...before, file: before.file.ok ? before.file.value : `<${before.file.error.code}>` },
    };
    const checks: Record<string, boolean> = {};

    if (phase === "write" || phase === "read") {
      faux.setResponses(
        phase === "write"
          ? [
              fauxAssistantMessage(fauxToolCall("write", { path: FILE, content: PROBE_FILE_CONTENT }), {
                stopReason: "toolUse",
              }),
              fauxAssistantMessage("Wrote result.md."),
            ]
          : [
              fauxAssistantMessage(fauxToolCall("read", { path: FILE }), { stopReason: "toolUse" }),
              fauxAssistantMessage("Read result.md."),
            ],
      );
      const submission = await root.submit(
        { type: "input", content: `P0-03 ${phase} turn`, requestId: `p0-03-${phase}` },
        context,
      );
      const settled = await submission.wait(context);
      report.submission = { id: submission.id, status: settled.status };
      checks.turnDone = settled.status === "done";
      checks.fixtureConsumed = faux.getPendingResponseCount() === 0;
      await db.run(
        "INSERT INTO hx_probe_runs (phase, pi_conversation, pi_submission, at_ms) VALUES (?, ?, ?, ?)",
        phase,
        root.id,
        submission.id,
        Date.now(),
      );
    }

    const after = { appRows: await appRows(db), transcript: await transcript(root) };
    const file = await env.readTextFile(`${WORKSPACE}/${FILE}`, context);
    report.after = { ...after, file: file.ok ? file.value : `<${file.error.code}>` };

    const toolResults = after.transcript.filter((line) => line.kind === "pi.tool-result");
    checks.fileWritten = file.ok && file.value === PROBE_FILE_CONTENT;
    checks.writeToolResult = toolResults.some((line) => line.text === `write: Successfully wrote to ${FILE}`);
    if (phase !== "write") {
      // What the first process committed is all visible here.
      checks.reopenedAppRow = before.appRows.some((row) => row.phase === "write");
      checks.reopenedTranscript = before.transcript.some((line) => line.text.startsWith("write: "));
      checks.reopenedFile = before.file.ok && before.file.value === PROBE_FILE_CONTENT;
    }
    if (phase === "read" || (phase === "inspect" && after.appRows.some((row) => row.phase === "read"))) {
      checks.readToolSawFile = toolResults.some((line) => line.text === `read: ${PROBE_FILE_CONTENT}`);
    }
    report.checks = checks;
    console.log(JSON.stringify(report, null, 2));
    return Object.values(checks).every(Boolean);
  } finally {
    // Pi storage closes the shared facade (P0-02), so it closes last; without it, close the facade directly.
    if (harness) await harness.close(context);
    else if (storage) await storage.close(context);
    else await db.close();
  }
}
