import { Command } from "commander";
import { ciCommand } from "./commands/ci.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
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
  .option("--force", "override a block caused by a low Push Safety Score (never overrides secrets); in the hook use PREFLUX_FORCE=1")
  .action(async (remote: string | undefined, _url: string | undefined, opts: { hook?: boolean; staged?: boolean; range?: string; json?: boolean; force?: boolean }) => {
    process.exitCode = await scanCommand({ ...opts, remote });
  });

program
  .command("link")
  .description("Connect this repository to a Preflux dashboard project, so every push shows up there")
  .argument("[token]", "project token from the dashboard (pfx_...)")
  .option("--url <dashboard>", "dashboard address, e.g. https://preflux.vercel.app")
  .option("--remove", "disconnect this repository from the dashboard")
  .action((token: string | undefined, opts: { url?: string; remove?: boolean }) => {
    process.exitCode = linkCommand(token, opts);
  });

program
  .command("ci")
  .description("Pull-request check: scan <base>..HEAD, comment on the PR, fail only if the score blocks (used by the GitHub Action)")
  .option("--base <branch>", "base branch (default: GITHUB_BASE_REF)")
  .action(async (opts: { base?: string }) => {
    process.exitCode = await ciCommand(opts);
  });

await program.parseAsync();
