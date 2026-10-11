import { gitBuffer } from "./exec.js";

/**
 * Read many `<rev>:<path>` blobs with a single `git cat-file --batch` process.
 * Returns null for specs that don't exist (e.g. a file deleted on that side).
 */
export function readBlobs(specs: string[], cwd: string): Array<string | null> {
  if (specs.length === 0) return [];
  const out = gitBuffer(["cat-file", "--batch"], cwd, `${specs.join("\n")}\n`);
  const blobs: Array<string | null> = [];
  let pos = 0;
  for (let i = 0; i < specs.length; i++) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    const m = /^\S+ (\S+) (\d+)$/.exec(header);
    if (!m) {
      blobs.push(null); // "<spec> missing"
      continue;
    }
    const size = Number(m[2]);
    blobs.push(m[1] === "blob" ? out.subarray(pos, pos + size).toString("utf8") : null);
    pos += size + 1; // content + trailing newline
  }
  return blobs;
}
