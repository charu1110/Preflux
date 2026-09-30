import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFaker } from "./helpers/fake.js";

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

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error("dist/index.js missing: run `npm run build` first");
  base = mkdtempSync(join(tmpdir(), "preflux-e2e-"));

  // A `preflux` shim on PATH, exactly what the hook looks for after `npm i -g preflux`.
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "preflux"), `#!/bin/sh\nexec node "${CLI.replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });
  env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };

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
      // Plain PATH without the shim.
      env: { ...process.env, NO_COLOR: "1" },
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
