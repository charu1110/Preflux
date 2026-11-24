import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScanReport } from "@preflux/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ciCommand, upsertComment } from "../src/commands/ci.js";
import { COMMENT_MARKER, renderMarkdown } from "../src/report/markdown.js";
import { makeFaker } from "./helpers/fake.js";
import { deadUrl } from "./helpers/mlStub.js";

const fake = makeFaker(5);

function report(overrides: Partial<ScanReport>): ScanReport {
  return {
    version: 1,
    tool: { name: "preflux", version: "test" },
    startedAt: "",
    mode: "manual",
    repo: "demo",
    ranges: [],
    findings: [],
    score: 100,
    scoreBreakdown: { bugRisk: 0, conflictRisk: 0 },
    decision: "allow",
    blockedBy: null,
    forced: false,
    modules: { secrets: { status: "ok", durationMs: 1 }, bugRisk: { status: "ok", durationMs: 1 }, conflicts: { status: "ok", durationMs: 1 } },
    ...overrides,
  };
}

describe("PR comment (markdown)", () => {
  it("summarises a clean change in one line and a table", () => {
    const md = renderMarkdown(report({}));
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("✅ **Preflux: all clear** — Push Safety Score 100/100");
    expect(md).toContain("| 🔑 Secrets | ✅ none found |");
  });

  it("explains a score block: risky files with reasons, conflicts and team heads-ups", () => {
    const md = renderMarkdown(
      report({
        score: 15,
        decision: "block",
        blockedBy: "score",
        findings: [
          { kind: "bug_risk", ruleId: "bug-risk", severity: "high", file: "lib/app.js", message: "high risk: riskier than 92% of past changes", reasons: ["big change (+180 lines)", "this file needed 7 bug fixes before"] },
          { kind: "conflict", ruleId: "conflict-same-function", severity: "high", file: "calc.js", line: 1, message: "total() was also edited on origin/main" },
          { kind: "conflict", ruleId: "collision-branch", severity: "low", file: "calc.js", line: 7, message: "Priya is also changing average()" },
        ],
      }),
    );
    expect(md).toContain("❌ **Preflux: blocked** — Push Safety Score 15/100");
    expect(md).toContain("- **HIGH** `lib/app.js` — riskier than 92% of past changes");
    expect(md).toContain("why: big change (+180 lines) · this file needed 7 bug fixes before");
    expect(md).toContain("⚠️ 1 with the base branch, 👥 1 team heads-up");
    expect(md).toContain("- 👥 `calc.js:7` — Priya is also changing average()");
    expect(md).toContain("PREFLUX_FORCE=1");
  });

  it("never puts a secret's snippet or fingerprint in the comment", () => {
    const md = renderMarkdown(
      report({
        score: 0,
        decision: "block",
        blockedBy: "secrets",
        findings: [{ kind: "secret", ruleId: "aws-access-key-id", severity: "critical", file: "config.js", line: 1, message: "AWS access key ID", maskedSnippet: "key = \"AKIA****\"", fingerprint: "0123456789abcdef" }],
      }),
    );
    expect(md).toContain("- **CRITICAL** AWS access key ID in `config.js:1`");
    expect(md).not.toContain("AKIA");
    expect(md).not.toContain("0123456789abcdef");
  });
});

describe("upsertComment", () => {
  const ctx = { token: "t", repo: "acme/shop", pr: 7, api: "https://api.test" };

  function fakeGitHub(existing: Array<{ id: number; body: string }>) {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
      if (!init?.method) return new Response(JSON.stringify(existing), { status: 200 });
      return new Response("{}", { status: init.method === "POST" ? 201 : 200 });
    }) as typeof fetch;
    return { impl, calls };
  }

  it("creates the comment the first time", async () => {
    const gh = fakeGitHub([{ id: 1, body: "LGTM" }]);
    expect(await upsertComment(ctx, `${COMMENT_MARKER}\nhello`, gh.impl)).toBe("created");
    expect(gh.calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "https://api.test/repos/acme/shop/issues/7/comments?per_page=100&page=1"],
      ["POST", "https://api.test/repos/acme/shop/issues/7/comments"],
    ]);
  });

  it("updates its own comment instead of adding another one", async () => {
    const gh = fakeGitHub([{ id: 1, body: "LGTM" }, { id: 42, body: `${COMMENT_MARKER}\nold` }]);
    expect(await upsertComment(ctx, `${COMMENT_MARKER}\nnew`, gh.impl)).toBe("updated");
    expect(gh.calls[1]).toMatchObject({ method: "PATCH", url: "https://api.test/repos/acme/shop/issues/comments/42" });
  });
});

describe("preflux ci on a real repository", () => {
  let dir: string;
  let work: string;
  const git = (...args: string[]) => spawnSync("git", args, { cwd: work, encoding: "utf8" });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "preflux-ci-"));
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", join(dir, "remote.git")]);
    spawnSync("git", ["clone", "-q", join(dir, "remote.git"), join(dir, "work")]);
    work = join(dir, "work");
    git("config", "user.email", "dev@preflux.local");
    git("config", "user.name", "Dev");
    git("checkout", "-q", "-b", "main");
    writeFileSync(join(work, "README.md"), "# shop\n");
    git("add", ".");
    git("commit", "-qm", "init");
    git("push", "-q", "origin", "main");
    // The pull request: a feature branch that leaks a key.
    git("checkout", "-q", "-b", "feature/pay");
    writeFileSync(join(work, "pay.js"), `module.exports = "${fake.stripeKey()}";\n`);
    git("add", ".");
    git("commit", "-qm", "add payments");
    process.env.PREFLUX_ML_URL = await deadUrl();
  });

  afterAll(() => {
    delete process.env.PREFLUX_ML_URL;
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails the check, writes the job summary and comments on the PR", async () => {
    const eventPath = join(dir, "event.json");
    const summary = join(dir, "summary.md");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 12 } }));
    const posted: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") posted.push(JSON.parse(init.body as string).body);
      return new Response(init?.method ? "{}" : "[]", { status: 200 });
    }) as typeof fetch;

    const code = await ciCommand({
      cwd: work,
      fetchImpl,
      env: { GITHUB_BASE_REF: "main", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "acme/shop", GITHUB_EVENT_PATH: eventPath, GITHUB_STEP_SUMMARY: summary },
    });

    expect(code).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("❌ **Preflux: blocked** — secrets found in this change");
    expect(posted[0]).toContain("Stripe secret or restricted key in `pay.js:1`");
    expect(readFileSync(summary, "utf8")).toContain(COMMENT_MARKER);
  });

  it("needs a base branch", async () => {
    expect(await ciCommand({ cwd: work, env: {} })).toBe(2);
  });
});
