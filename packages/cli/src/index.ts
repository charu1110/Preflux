import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { scanCommand } from "./commands/scan.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("preflux")
  .description("Pre-push code security and risk analysis. Blocks leaked secrets before they leave your machine.")
  .version(VERSION);

program
  .command("init")
  .description("Install the preflux pre-push hook and default config in this repository")
  .option("--skip-install", "don't install husky; write a plain .git/hooks/pre-push instead")
  .option("--force", "replace an existing pre-push hook")
  .action((opts: { skipInstall?: boolean; force?: boolean }) => {
    process.exitCode = initCommand(opts);
  });

program
  .command("scan")
  .description("Scan commits for secrets (defaults to commits not yet pushed)")
  .argument("[remote]", "remote name (passed by git in hook mode)")
  .argument("[url]", "remote URL (passed by git in hook mode)")
  .option("--hook", "run as a git pre-push hook (reads refs from stdin)")
  .option("--staged", "scan staged changes instead of commits")
  .option("--range <revisions>", "scan a git revision range, e.g. main..feature")
  .option("--json", "print the report as JSON on stdout")
  .action(async (remote: string | undefined, _url: string | undefined, opts: { hook?: boolean; staged?: boolean; range?: string; json?: boolean }) => {
    process.exitCode = await scanCommand({ ...opts, remote });
  });

await program.parseAsync();
