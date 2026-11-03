import { buildProgram } from "./cli/program.ts";

const program = buildProgram();
if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  await program.parseAsync(process.argv);
}
