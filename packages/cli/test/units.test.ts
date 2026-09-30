import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateTokens, maskLine, maskSecret, shannonEntropy } from "@preflux/shared/secrets";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/git/diff.js";
import { parsePrePushInput } from "../src/git/prePushInput.js";
import { globToRegExp, loadAllowlist } from "../src/secrets/allowlist.js";

describe("shannonEntropy", () => {
  it("matches known values", () => {
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("ab")).toBe(1);
    expect(shannonEntropy("abcd")).toBe(2);
    expect(shannonEntropy("0123456789abcdef")).toBe(4);
  });

  it("extracts candidate tokens and trims padding", () => {
    expect(candidateTokens(`key = "abcdefghijklmnopqrstuvwx=="; x = 1`, 20)).toEqual(["abcdefghijklmnopqrstuvwx"]);
  });
});

describe("masking", () => {
  it("hides all but a short prefix", () => {
    expect(maskSecret("abcdefghijklmnopqrst")).toBe("abcd********(20 chars)");
    const line = maskLine(`  token = "abcdefghijklmnopqrst"  `, ["abcdefghijklmnopqrst"]);
    expect(line).toBe(`token = "abcd********(20 chars)"`);
  });
});

describe("parseUnifiedDiff", () => {
  it("maps added lines to commits, files and new-file line numbers", () => {
    const out = [
      "\u0001PREFLUX_COMMIT aaaa111",
      "",
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@ function x() {",
      "+const one = 1;",
      "+const two = 2;",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "\u0001PREFLUX_COMMIT bbbb222",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/new file.py b/new file.py",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new file.py",
      "@@ -0,0 +1 @@",
      "+print('hi')",
      "\\ No newline at end of file",
    ].join("\n");

    expect(parseUnifiedDiff(out)).toEqual([
      { commit: "aaaa111", file: "src/a.ts", line: 4, text: "const one = 1;" },
      { commit: "aaaa111", file: "src/a.ts", line: 5, text: "const two = 2;" },
      { commit: "aaaa111", file: "src/a.ts", line: 12, text: "new" },
      { commit: "bbbb222", file: "new file.py", line: 1, text: "print('hi')" },
    ]);
  });
});

describe("parsePrePushInput", () => {
  it("parses one line per pushed ref", () => {
    const zero = "0".repeat(40);
    const a = "a".repeat(40);
    expect(parsePrePushInput(`refs/heads/main ${a} refs/heads/main ${zero}\n\n`)).toEqual([
      { localRef: "refs/heads/main", localSha: a, remoteRef: "refs/heads/main", remoteSha: zero },
    ]);
    expect(() => parsePrePushInput("garbage")).toThrow(/Unexpected/);
  });
});

describe("allowlist", () => {
  it("converts gitignore-style globs", () => {
    expect(globToRegExp("*.min.js").test("public/vendor/app.min.js")).toBe(true);
    expect(globToRegExp("docs/examples/**").test("docs/examples/aws/setup.md")).toBe(true);
    expect(globToRegExp("docs/examples/**").test("src/docs/examples/a.md")).toBe(false);
    expect(globToRegExp("fixtures/").test("fixtures/repo/a.ts")).toBe(true);
    expect(globToRegExp("/config.ts").test("src/config.ts")).toBe(false);
    expect(globToRegExp("config.ts").test("src/config.ts")).toBe(true);
  });

  it("loads .prefluxignore paths and fingerprints", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflux-allow-"));
    writeFileSync(join(dir, ".prefluxignore"), "# comment\ntest/fixtures/**\nfingerprint:0123456789abcdef\n");
    const allow = loadAllowlist(dir);
    expect(allow.isPathIgnored("test/fixtures/keys.env")).toBe(true);
    expect(allow.isPathIgnored("yarn.lock")).toBe(true); // built-in
    expect(allow.isPathIgnored("src/app.ts")).toBe(false);
    expect(allow.isFingerprintAllowed("0123456789abcdef")).toBe(true);
  });
});
