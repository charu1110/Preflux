import type { Finding, Severity } from "@preflux/shared";
import type { EntropyConfig } from "../config.js";
import type { AddedLine } from "../git/diff.js";
import { INLINE_ALLOW, type Allowlist } from "./allowlist.js";
import { candidateTokens, charsetOf, looksRandom, shannonEntropy } from "./entropy.js";
import { fingerprint, maskLine } from "./mask.js";
import { KEYWORD_ASSIGNMENT, SECRET_PATTERNS } from "./patterns.js";

// Values that are obviously documentation or templates rather than real credentials.
const PLACEHOLDER = /example|placeholder|changeme|change_me|your[_-]?|<[^>]*>|\$\{|\{\{|x{4,}|\*{4,}|dummy|sample|redacted/i;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_KEYWORD_NEARBY = /key|secret|token|passw|pwd|auth|cred|signature|salt/i;
const DATA_URI = /;base64,/i;
const SRI_HASH = /^sha(?:256|384|512)-/;

interface Hit {
  ruleId: string;
  message: string;
  severity: Severity;
  secret: string;
}

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/** Detect secrets on a single added line. Pure function; the unit tests exercise it directly. */
export function scanLine(text: string, entropy: EntropyConfig): Hit[] {
  if (text.includes(INLINE_ALLOW)) return [];
  const hits: Hit[] = [];
  const covered = (value: string) => hits.some((h) => h.secret.includes(value) || value.includes(h.secret));

  // 1. Known credential formats.
  for (const p of SECRET_PATTERNS) {
    for (const m of text.matchAll(p.regex)) {
      const secret = m[1] ?? m[0];
      if (p.id !== "private-key" && isPlaceholder(secret)) continue;
      if (covered(secret)) continue;
      hits.push({ ruleId: p.id, message: p.description, severity: p.severity, secret });
    }
  }

  // 2. Secret-looking keyword assigned a literal: lower entropy bar, because the name gives context.
  for (const m of text.matchAll(KEYWORD_ASSIGNMENT)) {
    const value = m[1]!;
    if (covered(value) || isPlaceholder(value) || ENV_VAR_NAME.test(value)) continue;
    if (/^https?:|\//.test(value)) continue; // URLs and paths
    if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) continue;
    if (shannonEntropy(value) < entropy.keywordThreshold) continue;
    hits.push({
      ruleId: "generic-secret-assignment",
      message: "Hard-coded credential assigned to a secret-named variable",
      severity: "high",
      secret: value,
    });
  }

  // 3. Unknown formats: high-entropy tokens.
  if (!DATA_URI.test(text)) {
    for (const token of candidateTokens(text, entropy.minLength)) {
      if (covered(token) || SRI_HASH.test(token) || isPlaceholder(token)) continue;
      const h = shannonEntropy(token);
      if (charsetOf(token) === "hex") {
        // Bare hex is usually a commit SHA or checksum; only flag it next to a secret-ish name.
        if (token.length >= 32 && h >= entropy.hexThreshold && SECRET_KEYWORD_NEARBY.test(text)) {
          hits.push({ ruleId: "high-entropy-hex", message: "High-entropy hex string next to a secret-like name", severity: "medium", secret: token });
        }
      } else if (h >= entropy.base64Threshold && looksRandom(token)) {
        hits.push({ ruleId: "high-entropy-base64", message: "High-entropy string that looks like a key or token", severity: "medium", secret: token });
      }
    }
  }
  return hits;
}

/** Scan added lines. Returns one finding per unique fingerprint (the first commit that introduced it). */
export function scanAddedLines(lines: AddedLine[], allowlist: Allowlist, entropy: EntropyConfig): Finding[] {
  const findings = new Map<string, Finding>();
  for (const l of lines) {
    if (allowlist.isPathIgnored(l.file)) continue;
    const hits = scanLine(l.text, entropy);
    if (hits.length === 0) continue;
    const snippet = maskLine(l.text, hits.map((h) => h.secret));
    for (const hit of hits) {
      const fp = fingerprint(hit.ruleId, l.file, hit.secret);
      if (allowlist.isFingerprintAllowed(fp) || findings.has(fp)) continue;
      findings.set(fp, {
        kind: "secret",
        ruleId: hit.ruleId,
        severity: hit.severity,
        message: hit.message,
        file: l.file,
        line: l.line,
        commit: l.commit,
        maskedSnippet: snippet,
        fingerprint: fp,
      });
    }
  }
  return [...findings.values()];
}
