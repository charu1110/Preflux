import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { AddedLine } from "../src/git/diff.js";
import { loadAllowlist, type Allowlist } from "../src/secrets/allowlist.js";
import { scanAddedLines, scanLine } from "../src/secrets/scanner.js";
import { makeFaker } from "./helpers/fake.js";

const entropy = DEFAULT_CONFIG.secrets.entropy;
const fake = makeFaker(7);
const rules = (text: string) => scanLine(text, entropy).map((h) => h.ruleId);

const allowNothing: Allowlist = { isPathIgnored: () => false, isFingerprintAllowed: () => false };

describe("known credential formats", () => {
  const cases: Array<[string, string]> = [
    ["aws-access-key-id", `const accessKeyId = "${fake.awsAccessKeyId()}";`],
    ["aws-secret-access-key", `aws_secret_access_key = ${fake.awsSecretAccessKey()}`],
    ["github-token", `GITHUB_TOKEN=${fake.githubToken()}`],
    ["github-fine-grained-pat", `token: ${fake.githubFineGrained()}`],
    ["gitlab-pat", `export GL=${fake.gitlabToken()}`],
    ["slack-token", `slack = "${fake.slackToken()}"`],
    ["slack-webhook", `WEBHOOK=${fake.slackWebhook()}`],
    ["stripe-key", `stripe.api_key = "${fake.stripeKey()}"`],
    ["google-api-key", `const maps = "${fake.googleApiKey()}"`],
    ["openai-api-key", `OPENAI_API_KEY=${fake.openaiKey()}`],
    ["anthropic-api-key", `ANTHROPIC_API_KEY=${fake.anthropicKey()}`],
    ["sendgrid-api-key", `sg = '${fake.sendgridKey()}'`],
    ["npm-token", `//registry.npmjs.org/:_authToken=${fake.npmToken()}`],
    ["private-key", fake.privateKeyHeader()],
    ["jwt", `const serviceRole = "${fake.jwt()}";`],
    ["db-connection-string", `DATABASE_URL=postgres://admin:${fake.dbPassword()}@db.internal:5432/app`],
  ];

  it.each(cases)("detects %s", (ruleId, line) => {
    expect(rules(line)).toContain(ruleId);
  });

  it("reports a secret once even when several detectors match it", () => {
    const hits = scanLine(`const k = "${fake.githubToken()}";`, entropy);
    expect(hits).toHaveLength(1);
  });
});

describe("keyword and entropy detection", () => {
  it("flags a hard-coded password assigned to a secret-named variable", () => {
    expect(rules(`db_password = "Adm1n@2024!"`)).toEqual(["generic-secret-assignment"]); // preflux:allow intentional test value
    expect(rules(`"apiKey": "k3y-${fake.chars(12, "abcdefghijklmnopqrstuvwxyz0123456789")}"`)).toEqual(["generic-secret-assignment"]);
  });

  it("flags an unknown high-entropy token", () => {
    expect(rules(`const x = "${fake.highEntropy()}";`)).toEqual(["high-entropy-base64"]);
  });

  it("flags long hex only next to a secret-like name", () => {
    const hex = fake.hex(40);
    expect(rules(`signing_key: ${hex}`)).toEqual(["high-entropy-hex"]);
    expect(rules(`// fixed in commit ${hex}`)).toEqual([]);
  });
});

describe("false positives", () => {
  const benign = [
    `import { useEffect, useState } from "react";`,
    `const id = "550e8400-e29b-41d4-a716-446655440000";`,
    `className="flex items-center justify-between px-4 py-2"`,
    `const token = localStorage.getItem("authToken");`,
    `password = request.form["password"]`,
    `SECRET_KEY = os.environ.get("SECRET_KEY")`,
    `api_key: "API_KEY_FROM_ENV",`,
    `const API_URL = "https://api.example.com/v1/users";`,
    `const hash = "d41d8cd98f00b204e9800998ecf8427e"; // md5 of ""`,
    `path: "src/components/dashboard/ProjectHealthCard.tsx"`,
    `const tokenType = "Bearer";`,
    `"version": "0.1.0",`,
    `test_user_email = "student@example.com"`,
    `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" />`,
    `<script integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"></script>`,
    `def get_password_hash(password: str) -> str:`,
    `DATABASE_URL=postgres://user:\${DB_PASSWORD}@localhost:5432/app`,
    `password = "your-password-here"`,
    `aws_access_key_id = AKIAIOSFODNN7EXAMPLE`,
    `export const DEFAULT_TIMEOUT_MS = 30_000;`,
  ];

  it.each(benign)("ignores: %s", (line) => {
    expect(rules(line)).toEqual([]);
  });

  it("respects an inline preflux:allow comment", () => {
    expect(rules(`const k = "${fake.githubToken()}"; // preflux:allow test fixture`)).toEqual([]);
  });
});

describe("scanAddedLines", () => {
  const secret = fake.stripeKey();
  const lines: AddedLine[] = [
    { commit: "c1", file: "src/pay.ts", line: 3, text: `const stripe = "${secret}";` },
    { commit: "c2", file: "src/pay.ts", line: 9, text: `const again = "${secret}";` },
    { commit: "c2", file: "package-lock.json", line: 1, text: `"integrity": "${fake.highEntropy()}"` },
  ];

  // Built-in defaults only (lockfiles, minified files), from an empty directory.
  const defaults = loadAllowlist(mkdtempSync(join(tmpdir(), "preflux-scan-")));

  it("returns masked findings that never contain the raw secret, skipping lockfiles", () => {
    const findings = scanAddedLines(lines, defaults, entropy);
    expect(findings).toHaveLength(1); // same secret in the same file = one finding
    const f = findings[0]!;
    expect(f).toMatchObject({ kind: "secret", ruleId: "stripe-key", file: "src/pay.ts", line: 3, commit: "c1", severity: "critical" });
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(f.maskedSnippet).toContain("sk_l");
    expect(f.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("honours path ignores and allowlisted fingerprints", () => {
    const [f] = scanAddedLines(lines, defaults, entropy);
    const allowFp: Allowlist = { isPathIgnored: () => false, isFingerprintAllowed: (fp) => fp === f!.fingerprint };
    expect(scanAddedLines(lines.slice(0, 2), allowFp, entropy)).toEqual([]);
    const ignoreAll: Allowlist = { isPathIgnored: () => true, isFingerprintAllowed: () => false };
    expect(scanAddedLines(lines, ignoreAll, entropy)).toEqual([]);
  });
});
