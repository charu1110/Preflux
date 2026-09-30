import type { Finding } from "@preflux/shared";
import { maskLine, scanLine, type EntropyConfig } from "@preflux/shared/secrets";
import type { AddedLine } from "../git/diff.js";
import type { Allowlist } from "./allowlist.js";
import { fingerprint } from "./fingerprint.js";

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
