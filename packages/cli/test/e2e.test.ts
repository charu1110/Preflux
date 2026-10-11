import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFaker } from "./helpers/fake.js";
import { deadUrl, startMlStub } from "./helpers/mlStub.js";

// Real repositories, a real bare remote and real `git push` runs through the installed hook.
// Requires `npm run build` first (the `test` script does it).

const CLI = resolve(__dirname, "../dist/index.js");
const fake = makeFaker(99);

let base: string;
let work: string;
let env: NodeJS.ProcessEnv;

function run(cmd: string, args: string[], cwd = work, input?: string) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", input });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
/** Async variant: keeps the event loop free so an in-process ML stub can answer the hook. */
function runAsync(cmd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: work, env: { ...env, ...extraEnv } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code: code ?? -1, out }));
  });
}
const gitOk = (...args: string[]) => {
  const r = run("git", args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed:\n${r.out}`);
  return r.out.trim();
};
const commitFile = (file: string, content: string, msg: string) => {
  writeFileSync(join(work, file), content);
  gitOk("add", file);
  gitOk("commit", "-q", "-m", msg);
};
const remoteHead = (branch = "main") => run("git", ["ls-remote", "origin", `refs/heads/${branch}`]).out.split(/\s/)[0] ?? "";

beforeAll(async () => {
  if (!existsSync(CLI)) throw new Error("dist/index.js missing: run `npm run build` first");
  base = mkdtempSync(join(tmpdir(), "preflux-e2e-"));

  // A `preflux` shim on PATH, exactly what the hook looks for after `npm i -g preflux`.
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "preflux"), `#!/bin/sh\nexec node "${CLI.replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });
  // Point at a dead ML URL by default, so a locally running service can't affect these tests.
  env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    PREFLUX_ML_URL: await deadUrl(),
  };

  run("git", ["init", "-q", "--bare", "-b", "main", join(base, "remote.git")], base);
  run("git", ["clone", "-q", join(base, "remote.git"), "work"], base);
  work = join(base, "work");
  gitOk("config", "user.email", "test@preflux.local");
  gitOk("config", "user.name", "Preflux Test");
  gitOk("checkout", "-q", "-b", "main");
  commitFile("README.md", "# demo\n", "initial");
  gitOk("push", "-q", "origin", "main");

  const init = run("node", [CLI, "init", "--skip-install"]);
  expect(init.code, init.out).toBe(0);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("preflux init", () => {
  it("writes the hook, config and ignore file", () => {
    expect(readFileSync(join(work, ".git", "hooks", "pre-push"), "utf8")).toContain("preflux scan --hook");
    expect(JSON.parse(readFileSync(join(work, ".prefluxrc.json"), "utf8")).secrets.entropy.base64Threshold).toBe(4.5);
    expect(existsSync(join(work, ".prefluxignore"))).toBe(true);
  });

  it("refuses to overwrite someone else's hook without --force", () => {
    const hook = join(work, ".git", "hooks", "pre-push");
    const original = readFileSync(hook, "utf8");
    writeFileSync(hook, "#!/bin/sh\necho custom\n");
    expect(run("node", [CLI, "init", "--skip-install"]).code).toBe(1);
    expect(run("node", [CLI, "init", "--skip-install", "--force"]).code).toBe(0);
    expect(readFileSync(hook, "utf8")).toBe(original);
  });
});

describe("pre-push hook", () => {
  it("allows a clean push", () => {
    commitFile(".gitignore", ".env\n", "add gitignore");
    gitOk("add", ".prefluxrc.json", ".prefluxignore");
    gitOk("commit", "-q", "-m", "preflux config");
    const push = run("git", ["push", "origin", "main"]);
    expect(push.code, push.out).toBe(0);
    expect(push.out).toContain("PUSH ALLOWED");
  });

  it("blocks a push that adds a secret, and never prints the raw value", () => {
    const before = remoteHead();
    const key = fake.awsAccessKeyId();
    commitFile("config.js", `module.exports = { accessKeyId: "${key}" };\n`, "add aws config");

    const push = run("git", ["push", "origin", "main"]);
    expect(push.code).not.toBe(0);
    expect(push.out).toContain("PUSH BLOCKED");
    expect(push.out).toContain("aws-access-key-id");
    expect(push.out).toContain("config.js:1");
    expect(push.out).not.toContain(key);
    expect(remoteHead()).toBe(before);
  });

  it("still blocks after the secret is deleted in a later commit (it is in history)", () => {
    commitFile("config.js", "module.exports = { accessKeyId: process.env.AWS_ACCESS_KEY_ID };\n", "use env var");
    const push = run("git", ["push", "origin", "main"]);
    expect(push.code).not.toBe(0);
    expect(push.out).toContain("aws-access-key-id");
  });

  it("allows the push once history is rewritten without the secret", () => {
    gitOk("reset", "-q", "--hard", "origin/main");
    commitFile("config.js", "module.exports = { accessKeyId: process.env.AWS_ACCESS_KEY_ID };\n", "use env var");
    const push = run("git", ["push", "origin", "main"]);
    expect(push.code, push.out).toBe(0);
  });

  it("scans every commit of a brand-new branch", () => {
    gitOk("checkout", "-q", "-b", "feature/payments");
    commitFile("pay.py", `STRIPE = "${fake.stripeKey()}"\n`, "payments");
    commitFile("notes.md", "wip\n", "notes");
    const push = run("git", ["push", "-u", "origin", "feature/payments"]);
    expect(push.code).not.toBe(0);
    expect(push.out).toContain("stripe-key");
    expect(remoteHead("feature/payments")).toBe("");
    gitOk("checkout", "-q", "main");
  });

  it("allows a push once the finding is allowlisted by fingerprint", () => {
    gitOk("checkout", "-q", "feature/payments");
    const json = run("node", [CLI, "scan", "--json"]);
    const report = JSON.parse(json.out.slice(json.out.indexOf("{")));
    expect(report.decision).toBe("block");
    const fp = report.findings[0].fingerprint as string;

    writeFileSync(join(work, ".prefluxignore"), `fingerprint:${fp}\n`);
    const push = run("git", ["push", "-u", "origin", "feature/payments"]);
    expect(push.code, push.out).toBe(0);
    gitOk("checkout", "-q", "--", ".prefluxignore");
    gitOk("checkout", "-q", "main");
  });

  it("allows deleting a remote branch", () => {
    const push = run("git", ["push", "origin", "--delete", "feature/payments"]);
    expect(push.code, push.out).toBe(0);
  });

  it("fails closed when the preflux binary is missing", () => {
    commitFile("b.txt", "b\n", "b");
    const r = spawnSync("git", ["push", "origin", "main"], {
      cwd: work,
      encoding: "utf8",
      // PATH without the shim, and without a globally installed/linked preflux (e.g. after `npm link`).
      env: {
        ...process.env,
        NO_COLOR: "1",
        PATH: (process.env.PATH ?? "")
          .split(delimiter)
          .filter((dir) => !["preflux", "preflux.cmd"].some((f) => existsSync(join(dir, f))))
          .join(delimiter),
      },
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("preflux: command not found");
  });
});

describe("preflux scan --staged", () => {
  it("catches a secret before it is even committed", () => {
    writeFileSync(join(work, "settings.py"), `GITHUB_TOKEN = "${fake.githubToken()}"\n`);
    gitOk("add", "settings.py");
    const r = run("node", [CLI, "scan", "--staged"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("github-token");
    gitOk("reset", "-q", "settings.py");
  });
});

describe("bug-risk prediction", () => {
  const lines = (n: number, tag: string) =>
    Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i};\n`).join("");

  it("shows per-file risk from the ML service and sends no paths or code", async () => {
    const stub = await startMlStub();
    try {
      gitOk("checkout", "-q", "main");
      writeFileSync(join(work, "big.ts"), lines(90, "big"));
      writeFileSync(join(work, "small.js"), lines(5, "small"));
      gitOk("add", "big.ts", "small.js");
      gitOk("commit", "-q", "-m", "add modules");

      const push = await runAsync("git", ["push", "origin", "main"], { PREFLUX_ML_URL: stub.url });
      expect(push.code, push.out).toBe(0);
      expect(push.out).toMatch(/bug risk\s+2 files analysed/);
      expect(push.out).toMatch(/90% HIGH\s+big\.ts/);
      expect(push.out).toMatch(/5% LOW\s+small\.js/);
      expect(push.out).toContain("1 high bug-risk file");

      expect(stub.requests).toHaveLength(1);
      const sent = stub.requests[0]!;
      expect(sent).not.toMatch(/big\.ts|small\.js|export const/);
    } finally {
      await stub.close();
    }
  });

  it("skips bug risk, but still pushes, when the ML service is down", async () => {
    commitFile("later.py", "x = 1\n", "small python change");
    const push = await runAsync("git", ["push", "origin", "main"]);
    expect(push.code, push.out).toBe(0);
    expect(push.out).toMatch(/bug risk\s+skipped \(ML service not reachable/);
    expect(push.out).toContain("PUSH ALLOWED");
  });

  it("still blocks secrets when bug risk is available", async () => {
    const stub = await startMlStub();
    try {
      commitFile("keys.js", `module.exports = "${fake.githubToken()}";\n`, "add keys");
      const push = await runAsync("git", ["push", "origin", "main"], { PREFLUX_ML_URL: stub.url });
      expect(push.code).not.toBe(0);
      expect(push.out).toContain("PUSH BLOCKED");
      expect(push.out).toMatch(/bug risk\s+1 file analysed/);
      gitOk("reset", "-q", "--hard", "origin/main");
    } finally {
      await stub.close();
    }
  });

  it("includes bug-risk findings in --json output", async () => {
    const stub = await startMlStub();
    try {
      commitFile("report.ts", lines(40, "r"), "add report");
      const r = await runAsync("node", [CLI, "scan", "--json"], { PREFLUX_ML_URL: stub.url });
      const report = JSON.parse(r.out.slice(r.out.indexOf("{")));
      expect(report.modules.bugRisk.status).toBe("ok");
      expect(report.findings).toContainEqual(
        expect.objectContaining({ kind: "bug_risk", file: "report.ts", severity: "medium", probability: 0.4 }),
      );
      expect(report.decision).toBe("allow");
    } finally {
      await stub.close();
    }
  });
});

describe("structural conflict detection", () => {
  const CALC = [
    "function total(items) {",
    "  let sum = 0;",
    "  for (const i of items) sum += i;",
    "  return sum;",
    "}",
    "",
    "function average(items) {",
    "  return items.length ? total(items) / items.length : 0;",
    "}",
    "",
  ].join("\n");
  let mate: string;
  const gitIn = (cwd: string, ...args: string[]) => {
    const r = run("git", args, cwd);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed:\n${r.out}`);
    return r.out.trim();
  };

  beforeAll(() => {
    // Our side: calc.js lands on main.
    gitOk("checkout", "-q", "main");
    commitFile("calc.js", CALC, "add calc");
    expect(run("git", ["push", "-q", "origin", "main"]).code).toBe(0);

    // A teammate clones, edits the END of total() and pushes to main (no hook on their machine).
    mate = join(base, "mate");
    run("git", ["clone", "-q", join(base, "remote.git"), mate], base);
    gitIn(mate, "config", "user.email", "mate@preflux.local");
    gitIn(mate, "config", "user.name", "Mate");
    writeFileSync(join(mate, "calc.js"), CALC.replace("return sum;", "return Math.round(sum);"));
    gitIn(mate, "commit", "-qam", "Round totals");
    gitIn(mate, "push", "-q", "origin", "main");
  });

  it("warns when we edit the same function on a branch, even though Git would merge cleanly", () => {
    // We edit the START of total() on a feature branch, without having fetched the teammate's work.
    gitOk("checkout", "-q", "-b", "feature/discount", "main");
    writeFileSync(join(work, "calc.js"), CALC.replace("let sum = 0;", "let sum = 0; // before discount"));
    gitOk("commit", "-qam", "Prepare discount");

    const push = run("git", ["push", "origin", "feature/discount"]);
    expect(push.code, push.out).toBe(0); // informational: never blocks
    expect(push.out).toMatch(/conflicts\s+1 possible conflict \(compared with origin\/main\)/);
    expect(push.out).toContain("calc.js:1");
    expect(push.out).toMatch(/total\(\) was also edited on origin\/main \([0-9a-f]{7} by Mate\)/);
    expect(push.out).toContain("merge them silently");
    expect(push.out).toContain("PUSH ALLOWED");
  });

  it("includes conflicts in --json and stays quiet when nothing overlaps", () => {
    const report = JSON.parse(run("node", [CLI, "scan", "--json", "--range", "main..feature/discount"]).out);
    expect(report.modules.conflicts.status).toBe("ok");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ kind: "conflict", ruleId: "conflict-same-function", severity: "high", file: "calc.js", line: 1 }),
    );

    // A branch that only touches average() doesn't clash with the teammate's total() edit.
    gitOk("checkout", "-q", "-b", "feature/mean", "main");
    writeFileSync(join(work, "calc.js"), CALC.replace(": 0;", ": NaN;"));
    gitOk("commit", "-qam", "NaN for empty");
    const clean = JSON.parse(run("node", [CLI, "scan", "--json", "--range", "main..feature/mean"]).out);
    expect(clean.modules.conflicts.status).toBe("ok");
    expect(clean.findings.filter((f: { kind: string }) => f.kind === "conflict")).toEqual([]);
  });

  it("falls back to the last known base branch when the fetch fails", () => {
    gitOk("checkout", "-q", "feature/discount");
    const url = gitOk("remote", "get-url", "origin");
    gitOk("remote", "set-url", "origin", join(base, "does-not-exist.git"));
    try {
      const report = JSON.parse(run("node", [CLI, "scan", "--json", "--range", "main..feature/discount"]).out);
      expect(report.modules.conflicts.reason).toContain("could not fetch origin/main; used the last known state");
      expect(report.findings.some((f: { ruleId: string }) => f.ruleId === "conflict-same-function")).toBe(true);
    } finally {
      gitOk("remote", "set-url", "origin", url);
    }
  });
});
