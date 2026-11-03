// pi-durable's own Storage conformance suite, run against SqliteStorage over the Horcrux home facade on a temp file.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { openHomeDatabase } from "./home-database.ts";

registerStorageConformance(
  { describe, expect: expect as never, it },
  "pi-durable SqliteStorage over openHomeDatabase (temp file, prefix pi_)",
  async (use) => {
    const dir = mkdtempSync(join(tmpdir(), "hx-p0-02-conf-"));
    try {
      const db = await openHomeDatabase(join(dir, "home.horcrux"));
      const storage = await SqliteStorage.open(db, { prefix: "pi_" });
      try {
        await use(storage);
      } finally {
        await storage.close(BACKGROUND_CONTEXT).catch(() => {});
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
