import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import chalk from "chalk";
import { CONFIG_FILE, DEFAULT_CONFIG } from "../config.js";
import { git, repoRoot } from "../git/exec.js";

export interface InitOptions {
  /** Don't npm-install husky; fall back to a plain .git/hooks/pre-push. */
  skipInstall?: boolean;
  /** Overwrite an existing pre-push hook that wasn't written by preflux. */
  force?: boolean;
  cwd?: string;
}

const HOOK_MARKER = "# preflux pre-push hook";

export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}: blocks pushes that leak secrets. Remove this file to uninstall.
if command -v preflux >/dev/null 2>&1; then
  preflux scan --hook "$@"
elif [ -x ./node_modules/.bin/preflux ]; then
  ./node_modules/.bin/preflux scan --hook "$@"
else
  echo "preflux: command not found. Install it with 'npm install -g preflux', or bypass once with 'git push --no-verify'." >&2
  exit 1
fi
`;

const IGNORE_TEMPLATE = `# .prefluxignore: paths and findings the preflux secret scanner should skip.
# Glob patterns, one per line (lockfiles and minified files are already skipped):
# docs/examples/**
#
# Allow one specific finding by the fingerprint shown in the scan report:
# fingerprint:1a2b3c4d5e6f7a8b
`;

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  const file = join(root, "package.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as PackageJson) : null;
}

const hasHusky = (pkg: PackageJson) => Boolean(pkg.dependencies?.husky ?? pkg.devDependencies?.husky);

function run(cmd: string, cwd: string) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

/** Use husky when this is a Node project (shared, version-controlled hooks); otherwise write .git/hooks/pre-push. */
function installHook(root: string, opts: InitOptions): string {
  const pkg = readPackageJson(root);
  let useHusky = pkg !== null && hasHusky(pkg);

  if (pkg && !useHusky && !opts.skipInstall) {
    console.log(chalk.gray("Installing husky (dev dependency)…"));
    run("npm install --save-dev husky", root);
    useHusky = true;
  }

  let hookFile: string;
  if (useHusky) {
    const fresh = readPackageJson(root) ?? {};
    fresh.scripts = { ...fresh.scripts };
    if (!fresh.scripts.prepare?.includes("husky")) {
      fresh.scripts.prepare = fresh.scripts.prepare ? `${fresh.scripts.prepare} && husky` : "husky";
      writeFileSync(join(root, "package.json"), `${JSON.stringify(fresh, null, 2)}\n`);
    }
    run("npx --no-install husky", root); // sets core.hooksPath to .husky/_
    hookFile = join(root, ".husky", "pre-push");
  } else {
    const hooksDir = git(["rev-parse", "--git-path", "hooks"], root).trim();
    hookFile = join(isAbsolute(hooksDir) ? hooksDir : join(root, hooksDir), "pre-push");
  }

  if (existsSync(hookFile) && !readFileSync(hookFile, "utf8").includes(HOOK_MARKER) && !opts.force) {
    throw new Error(
      `A pre-push hook already exists at ${hookFile}. Add "preflux scan --hook \\"$@\\"" to it yourself, or re-run with --force to replace it.`,
    );
  }
  mkdirSync(dirname(hookFile), { recursive: true });
  writeFileSync(hookFile, HOOK_SCRIPT, { mode: 0o755 });
  chmodSync(hookFile, 0o755);
  return hookFile;
}

export function initCommand(opts: InitOptions): number {
  try {
    const root = repoRoot(opts.cwd ?? process.cwd());

    const configFile = join(root, CONFIG_FILE);
    if (!existsSync(configFile)) writeFileSync(configFile, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    const ignoreFile = join(root, ".prefluxignore");
    if (!existsSync(ignoreFile)) writeFileSync(ignoreFile, IGNORE_TEMPLATE);

    const hookFile = installHook(root, opts);
    console.log(chalk.green("✔ preflux installed"));
    console.log(`  hook    ${hookFile}`);
    console.log(`  config  ${configFile}`);
    console.log(chalk.gray("  Every git push is now scanned. Try it now with: preflux scan"));
    return 0;
  } catch (err) {
    console.error(chalk.red(`preflux init failed: ${(err as Error).message}`));
    return 1;
  }
}
