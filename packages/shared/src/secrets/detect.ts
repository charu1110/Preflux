import type { Severity } from "../index";
import { candidateTokens, charsetOf, looksRandom, shannonEntropy } from "./entropy";
import { KEYWORD_ASSIGNMENT, SECRET_PATTERNS } from "./patterns";

// Pure, dependency-free detection: runs in Node (CLI) and in the browser (dashboard demo).

export interface EntropyConfig {
  /** Bits/char above which an unexplained base64 token is flagged. */
  base64Threshold: number;
  /** Bits/char above which a hex token next to a secret-ish keyword is flagged. */
  hexThreshold: number;
  /** Bits/char for values assigned to keywords like `password` / `apiKey`. */
  keywordThreshold: number;
  minLength: number;
}

export const DEFAULT_ENTROPY_CONFIG: EntropyConfig = {
  base64Threshold: 4.5,
  hexThreshold: 3.0,
  keywordThreshold: 3.0,
  minLength: 20,
};

export const INLINE_ALLOW = "preflux:allow";

export interface SecretHit {
  ruleId: string;
  message: string;
  severity: Severity;
  /** The raw secret. Never print, upload or store it; mask it with maskSecret/maskLine first. */
  secret: string;
  /** Shannon entropy of the secret, in bits per character. */
  entropy: number;
}

// Values that are obviously documentation or templates rather than real credentials.
const PLACEHOLDER = /example|placeholder|changeme|change_me|your[_-]?|<[^>]*>|\$\{|\{\{|x{4,}|\*{4,}|dummy|sample|redacted/i;
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_KEYWORD_NEARBY = /key|secret|token|passw|pwd|auth|cred|signature|salt/i;
const DATA_URI = /;base64,/i;
const SRI_HASH = /^sha(?:256|384|512)-/;

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/** Detect secrets on a single line of code. */
export function scanLine(text: string, entropy: EntropyConfig = DEFAULT_ENTROPY_CONFIG): SecretHit[] {
  if (text.includes(INLINE_ALLOW)) return [];
  const hits: SecretHit[] = [];
  const covered = (value: string) => hits.some((h) => h.secret.includes(value) || value.includes(h.secret));
  const add = (ruleId: string, message: string, severity: Severity, secret: string) =>
    hits.push({ ruleId, message, severity, secret, entropy: shannonEntropy(secret) });

  // 1. Known credential formats.
  for (const p of SECRET_PATTERNS) {
    for (const m of text.matchAll(p.regex)) {
      const secret = m[1] ?? m[0];
      if (p.id !== "private-key" && isPlaceholder(secret)) continue;
      if (covered(secret)) continue;
      add(p.id, p.description, p.severity, secret);
    }
  }

  // 2. Secret-looking keyword assigned a literal: lower entropy bar, because the name gives context.
  for (const m of text.matchAll(KEYWORD_ASSIGNMENT)) {
    const value = m[1]!;
    if (covered(value) || isPlaceholder(value) || ENV_VAR_NAME.test(value)) continue;
    if (/^https?:|\//.test(value)) continue; // URLs and paths
    if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) continue;
    if (shannonEntropy(value) < entropy.keywordThreshold) continue;
    add("generic-secret-assignment", "Hard-coded credential assigned to a secret-named variable", "high", value);
  }

  // 3. Unknown formats: high-entropy tokens.
  if (!DATA_URI.test(text)) {
    for (const token of candidateTokens(text, entropy.minLength)) {
      if (covered(token) || SRI_HASH.test(token) || isPlaceholder(token)) continue;
      const h = shannonEntropy(token);
      if (charsetOf(token) === "hex") {
        // Bare hex is usually a commit SHA or checksum; only flag it next to a secret-ish name.
        if (token.length >= 32 && h >= entropy.hexThreshold && SECRET_KEYWORD_NEARBY.test(text)) {
          add("high-entropy-hex", "High-entropy hex string next to a secret-like name", "medium", token);
        }
      } else if (h >= entropy.base64Threshold && looksRandom(token)) {
        add("high-entropy-base64", "High-entropy string that looks like a key or token", "medium", token);
      }
    }
  }
  return hits;
}
