import { appendFileSync, readFileSync } from "node:fs";
import { renderMarkdown, COMMENT_MARKER } from "../report/markdown.js";
import { renderReport } from "../report/terminal.js";
import { repoRoot } from "../git/exec.js";
import { recordPush, runScan } from "./scan.js";

// `preflux ci`: the pull-request check (used by the GitHub Action in action.yml).
// Scans <base>..HEAD, writes the job summary, keeps one up-to-date PR comment, and fails the
// check only when the Push Safety Score says "block".

export interface CiOptions {
  /** Base branch name; defaults to GITHUB_BASE_REF (set by GitHub on pull_request events). */
  base?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

interface GitHubContext {
  token: string;
  repo: string;
  pr: number;
  api: string;
}

function prContext(env: NodeJS.ProcessEnv): GitHubContext | null {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_EVENT_PATH: eventPath } = env;
  if (!token || !repo || !eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as { pull_request?: { number?: number } };
    const pr = event.pull_request?.number;
    return pr ? { token, repo, pr, api: env.GITHUB_API_URL ?? "https://api.github.com" } : null;
  } catch {
    return null;
  }
}

/** Create the Preflux comment, or update it if this PR already has one. */
export async function upsertComment(ctx: GitHubContext, body: string, fetchImpl: typeof fetch = fetch): Promise<"created" | "updated"> {
  const headers = { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const base = `${ctx.api}/repos/${ctx.repo}/issues`;
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`${base}/${ctx.pr}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`listing comments failed: HTTP ${res.status}`);
    const comments = (await res.json()) as Array<{ id: number; body?: string }>;
    const mine = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (mine) {
      const upd = await fetchImpl(`${base}/comments/${mine.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) });
      if (!upd.ok) throw new Error(`updating the comment failed: HTTP ${upd.status}`);
      return "updated";
    }
    if (comments.length < 100) break;
  }
  const res = await fetchImpl(`${base}/${ctx.pr}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`posting the comment failed: HTTP ${res.status}`);
  return "created";
}

export async function ciCommand(opts: CiOptions = {}): Promise<number> {
  const env = opts.env ?? process.env;
  const base = opts.base ?? env.GITHUB_BASE_REF;
  if (!base) {
    process.stderr.write("preflux ci: no base branch. Run it on a pull_request event, or pass --base main.\n");
    return 2;
  }

  let report;
  try {
    report = await runScan({ range: `origin/${base}..HEAD`, remote: "origin", cwd: opts.cwd, ci: true, force: /^(1|true|yes)$/i.test(env.PREFLUX_FORCE ?? "") });
  } catch (err) {
    process.stderr.write(`preflux ci: ${(err as Error).message}\n`);
    return 2;
  }

  const markdown = renderMarkdown(report);
  process.stderr.write(`${renderReport(report)}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);

  const ctx = prContext(env);
  if (ctx) {
    try {
      const how = await upsertComment(ctx, markdown, opts.fetchImpl);
      process.stderr.write(`preflux ci: PR comment ${how}.\n`);
    } catch (err) {
      // e.g. pull requests from forks get a read-only token. The check result still counts.
      process.stderr.write(`preflux ci: could not comment on the PR (${(err as Error).message}).\n`);
    }
  }

  // Optional: record the PR on the team dashboard (PREFLUX_TOKEN + PREFLUX_DASHBOARD_URL secrets).
  const note = await recordPush(report, repoRoot(opts.cwd ?? process.cwd()), { branch: env.GITHUB_HEAD_REF, author: env.GITHUB_ACTOR }, env);
  if (note) process.stderr.write(`preflux ci: ${note}\n`);
  return report.decision === "block" && !report.forced ? 1 : 0;
}
