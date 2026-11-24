import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScanReport } from "@preflux/shared";
import { toIngestPayload, validateIngestPayload } from "@preflux/shared/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readLink } from "../src/api/dashboardClient.js";
import { linkCommand } from "../src/commands/link.js";
import { recordPush } from "../src/commands/scan.js";

const TOKEN = `pfx_${"ab12".repeat(12)}`;

const report: ScanReport = {
  version: 1,
  tool: { name: "preflux", version: "0.1.0" },
  startedAt: "",
  mode: "hook",
  repo: "shop",
  ranges: [],
  findings: [
    { kind: "secret", ruleId: "aws-access-key-id", severity: "critical", file: "config.js", line: 1, message: "AWS access key ID", maskedSnippet: 'key = "AKIA********(20 chars)"', fingerprint: "0123456789abcdef", commit: "abc" },
    { kind: "bug_risk", ruleId: "bug-risk", severity: "high", file: "app.js", message: "high risk", probability: 0.4, percentile: 97, reasons: ["big change (+200 lines)"] },
  ],
  score: 0,
  scoreBreakdown: { bugRisk: 1, conflictRisk: 0 },
  decision: "block",
  blockedBy: "secrets",
  forced: false,
  modules: { secrets: { status: "ok", durationMs: 1 }, bugRisk: { status: "ok", durationMs: 1 }, conflicts: { status: "ok", durationMs: 1 } },
};

describe("upload payload", () => {
  it("carries the dashboard fields but no snippets, fingerprints or commits", () => {
    const payload = toIngestPayload(report, { branch: "main", author: "Charu" });
    expect(payload).toMatchObject({ branch: "main", author: "Charu", score: 0, decision: "block", blockedBy: "secrets", bugRisk: 1, toolVersion: "0.1.0" });
    const json = JSON.stringify(payload);
    expect(json).not.toContain("AKIA");
    expect(json).not.toContain("0123456789abcdef");
    expect(payload.findings[1]).toEqual({ kind: "bug_risk", ruleId: "bug-risk", severity: "high", file: "app.js", message: "high risk", probability: 0.4, percentile: 97, reasons: ["big change (+200 lines)"] });
    expect(validateIngestPayload(JSON.parse(json))).toBeNull();
  });

  it("is rejected by the server when malformed", () => {
    const ok = toIngestPayload(report, {});
    expect(validateIngestPayload(null)).toBe("body must be a JSON object");
    expect(validateIngestPayload({ ...ok, decision: "maybe" })).toMatch(/decision/);
    expect(validateIngestPayload({ ...ok, score: 140 })).toMatch(/score/);
    expect(validateIngestPayload({ ...ok, findings: [{ ...ok.findings[0], kind: "virus" }] })).toMatch(/kind/);
    expect(validateIngestPayload({ ...ok, findings: Array(301).fill(ok.findings[0]) })).toMatch(/at most 300/);
    expect(validateIngestPayload({ ...ok, branch: "x".repeat(201) })).toMatch(/too long/);
  });
});

describe("preflux link + recording pushes", () => {
  let dir: string;
  let server: ReturnType<typeof createServer>;
  let url: string;
  const received: Array<{ auth?: string; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "preflux-link-"));
    spawnSync("git", ["init", "-q", dir]);
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(201, { "content-type": "application/json" }).end('{"pushId":"x"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a bad token or URL", () => {
    expect(linkCommand("not-a-token", { url, cwd: dir })).toBe(1);
    expect(linkCommand(TOKEN, { url: "ftp://x", cwd: dir })).toBe(1);
  });

  it("stores the link inside .git so it can't be committed", () => {
    expect(linkCommand(TOKEN, { url, cwd: dir })).toBe(0);
    const file = join(dir, ".git", "preflux-link.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ token: TOKEN, url });
    expect(readLink(dir, {})).toEqual({ token: TOKEN, url });
  });

  it("uploads a push with the token, and says so", async () => {
    const note = await recordPush(report, dir, { branch: "feature/pay", author: "Charu" }, {});
    expect(note).toBe("dashboard: push recorded");
    expect(received.at(-1)).toMatchObject({ auth: `Bearer ${TOKEN}`, body: { branch: "feature/pay", author: "Charu", decision: "block" } });
  });

  it("never breaks a push when the dashboard is down", async () => {
    linkCommand(TOKEN, { url: "http://127.0.0.1:9", cwd: dir });
    const note = await recordPush(report, dir, {}, {});
    expect(note).toMatch(/^dashboard: not recorded \(dashboard not reachable/);
  });

  it("does nothing when the repository isn't linked, and can be unlinked", async () => {
    expect(linkCommand(undefined, { remove: true, cwd: dir })).toBe(0);
    expect(await recordPush(report, dir, {}, {})).toBeNull();
  });

  it("CI can link through environment variables instead of a file", () => {
    expect(readLink(dir, { PREFLUX_TOKEN: TOKEN, PREFLUX_DASHBOARD_URL: url })).toEqual({ token: TOKEN, url });
  });
});
