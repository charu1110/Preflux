import chalk from "chalk";
import { TOKEN_PATTERN, removeLink, writeLink } from "../api/dashboardClient.js";
import { repoRoot } from "../git/exec.js";

export interface LinkOptions {
  url?: string;
  remove?: boolean;
  cwd?: string;
}

/** `preflux link <token> --url <dashboard>`: connect this repository to a dashboard project. */
export function linkCommand(token: string | undefined, opts: LinkOptions): number {
  try {
    const root = repoRoot(opts.cwd ?? process.cwd());
    if (opts.remove) {
      console.log(removeLink(root) ? chalk.green("✔ dashboard link removed") : "no dashboard link to remove");
      return 0;
    }
    if (!token || !TOKEN_PATTERN.test(token)) {
      console.error(chalk.red("preflux link: expected a project token like pfx_… (create one on your project's page in the dashboard)."));
      return 1;
    }
    if (!opts.url || !/^https?:\/\/[^\s]+$/.test(opts.url)) {
      console.error(chalk.red("preflux link: pass the dashboard address, e.g. --url https://preflux.vercel.app"));
      return 1;
    }
    const file = writeLink(root, { token, url: opts.url });
    console.log(chalk.green("✔ linked to the dashboard"));
    console.log(chalk.gray(`  saved in ${file} (inside .git, so it is never committed)`));
    console.log(chalk.gray("  Every push from this repository now shows up on the dashboard."));
    return 0;
  } catch (err) {
    console.error(chalk.red(`preflux link failed: ${(err as Error).message}`));
    return 1;
  }
}
