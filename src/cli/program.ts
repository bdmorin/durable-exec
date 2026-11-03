import { Command } from "commander";

export const VERSION = "0.0.0";

/** Build the top-level command. Pure: constructing it performs no I/O. */
export function buildProgram(): Command {
  const program = new Command("horcrux")
    .description("Local-first agent application with one authoritative SQLite home.")
    .version(VERSION)
    .option("--home <file>", "select the home database (overrides HORCRUX_HOME)")
    .showHelpAfterError();

  // PHASE 0 PROBE (P0-03), hidden from help: see src/cli/probe-p0-03.ts. Loaded lazily so help never touches Pi.
  program.addCommand(
    new Command("probe-p0-03")
      .description("Phase 0 probe: Pi storage + file tool in one home (OFFLINE FIXTURE model)")
      .argument("<phase>", "write | read | inspect")
      .argument("<home>", "home file to create or reopen")
      .action(async (phase: string, home: string) => {
        if (phase !== "write" && phase !== "read" && phase !== "inspect") {
          return program.error(`probe-p0-03: unknown phase '${phase}' (write | read | inspect)`);
        }
        const { runP0_03Probe } = await import("./probe-p0-03.ts");
        if (!(await runP0_03Probe(phase, home))) process.exitCode = 1;
      }),
    { hidden: true },
  );
  return program;
}
