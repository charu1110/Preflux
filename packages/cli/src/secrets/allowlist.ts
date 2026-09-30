import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Files that are noisy by nature (hashes, minified bundles) and never hold hand-written secrets. */
export const DEFAULT_IGNORED_PATHS = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Cargo.lock",
  "go.sum",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.svg",
];

export const INLINE_ALLOW = "preflux:allow";

export interface Allowlist {
  isPathIgnored(file: string): boolean;
  isFingerprintAllowed(fp: string): boolean;
}

/** Convert a gitignore-style glob to a RegExp. Supports `**`, `*` and `?`. A pattern without "/" matches at any depth. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim().replace(/\\/g, "/");
  if (g.startsWith("/")) g = g.slice(1);
  else if (!g.replace(/\/$/, "").includes("/")) g = `**/${g}`;
  if (g.endsWith("/")) g = `${g}**`;

  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === "*") {
      if (g[i + 1] === "*") {
        const slashAfter = g[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // A match on a directory also covers everything inside it.
  return new RegExp(`^${re}(?:/.*)?$`);
}

/**
 * .prefluxignore format:
 *   # comment
 *   docs/examples/**                 skip files matching this glob
 *   fingerprint:1a2b3c4d5e6f7a8b     allow one specific finding
 */
export function loadAllowlist(root: string, extraIgnoredPaths: string[] = []): Allowlist {
  const globs = [...DEFAULT_IGNORED_PATHS, ...extraIgnoredPaths];
  const fingerprints = new Set<string>();

  const file = join(root, ".prefluxignore");
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("fingerprint:")) fingerprints.add(line.slice("fingerprint:".length).trim());
      else globs.push(line);
    }
  }

  const regexes = globs.map(globToRegExp);
  return {
    isPathIgnored: (f) => regexes.some((r) => r.test(f)),
    isFingerprintAllowed: (fp) => fingerprints.has(fp),
  };
}
