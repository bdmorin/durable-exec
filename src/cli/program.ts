import { Command } from "commander";

export const VERSION = "0.0.0";

/** Build the top-level command. Pure: constructing it performs no I/O. */
export function buildProgram(): Command {
  return new Command("horcrux")
    .description("Local-first agent application with one authoritative SQLite home.")
    .version(VERSION)
    .option("--home <file>", "select the home database (overrides HORCRUX_HOME)")
    .showHelpAfterError();
}
