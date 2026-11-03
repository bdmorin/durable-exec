// Migration 1: home identity and migration history. Deliberately nothing else: later Phase 1 work (journal,
// settings) appends its own migrations, and Phase 2 owns `hx_files` (the P0-03 stub table is not adopted here).

import { randomUUID } from "node:crypto";
import type { Migration } from "./index.ts";

/** `hx_meta.format` of every Horcrux home. Frozen. */
export const HOME_FORMAT = "horcrux-home";
/** SQLite header `application_id` of every Horcrux home ("HRCX"). Frozen. */
export const HX_APPLICATION_ID = 0x48524358;

export const migration: Migration = {
  id: 1,
  name: "home-identity",
  async up(tx, context) {
    // `format` and `format_version` in hx_meta, and the application_id header, are frozen for all future versions:
    // older binaries read them to refuse homes they do not understand.
    await tx.exec(`
      CREATE TABLE hx_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
      CREATE TABLE hx_migrations (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        app_version TEXT NOT NULL,
        runtime TEXT NOT NULL
      );
      PRAGMA application_id = ${HX_APPLICATION_ID};
    `);
    const rows: [string, string][] = [
      ["format", HOME_FORMAT],
      ["home_id", randomUUID()],
      ["created_at", context.now],
      ["created_app_version", context.appVersion],
      ["created_runtime", context.runtime],
      ["created_sqlite_version", context.sqliteVersion],
    ];
    for (const [key, value] of rows) await tx.run("INSERT INTO hx_meta (key, value) VALUES (?, ?)", key, value);
  },
};
