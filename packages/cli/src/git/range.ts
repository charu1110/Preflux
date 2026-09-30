import { commitExists, git, tryGit } from "./exec.js";
import { isZeroSha, type PushedRef } from "./prePushInput.js";

/** A set of commits to scan, expressed as `git log` revision arguments. */
export interface RevisionSet {
  label: string;
  revArgs: string[];
}

const short = (sha: string) => sha.slice(0, 7);

/**
 * Work out which commits a pushed ref would send to the remote.
 * - Deleting a remote branch sends nothing, so it returns null.
 * - Updating a branch the remote already has: remoteSha..localSha.
 * - New branch (or remote tip unknown locally): every commit not already on the remote.
 */
export function revisionsForPushedRef(ref: PushedRef, remoteName: string | undefined, cwd: string): RevisionSet | null {
  if (isZeroSha(ref.localSha)) return null;

  if (!isZeroSha(ref.remoteSha) && commitExists(ref.remoteSha, cwd)) {
    return {
      label: `${ref.localRef} ${short(ref.remoteSha)}..${short(ref.localSha)}`,
      revArgs: [`${ref.remoteSha}..${ref.localSha}`],
    };
  }

  // When pushing to a URL instead of a named remote, exclude commits known on any remote.
  const knownRemote = remoteName && tryGit(["remote", "get-url", remoteName], cwd) !== null;
  const notOnRemote = knownRemote ? `--remotes=${remoteName}` : "--remotes";
  return {
    label: `${ref.localRef} (new) ..${short(ref.localSha)}`,
    revArgs: [ref.localSha, "--not", notOnRemote],
  };
}

/** Default for a manual `preflux scan`: commits not yet pushed to the upstream (or to any remote). */
export function unpushedRevisions(cwd: string): RevisionSet {
  const upstream = tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd)?.trim();
  if (upstream) {
    return { label: `${upstream}..HEAD`, revArgs: ["@{u}..HEAD"] };
  }
  return { label: "HEAD (not on any remote)", revArgs: ["HEAD", "--not", "--remotes"] };
}

export function countCommits(revArgs: string[], cwd: string): number {
  const out = git(["rev-list", "--count", ...revArgs], cwd).trim();
  return Number.parseInt(out, 10) || 0;
}
