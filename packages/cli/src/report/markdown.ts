import type { Finding, ScanReport } from "@preflux/shared";

// The pull-request comment. Short on purpose: one verdict line, one table, then only the details
// that need action. Secrets are listed by rule and location only, never with a snippet, because
// PR comments on public repositories are public.

export const COMMENT_MARKER = "<!-- preflux-report -->";

const LEVEL: Record<string, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW" };
const where = (f: Finding) => `\`${f.file}${f.line ? `:${f.line}` : ""}\``;
const isRadar = (f: Finding) => f.ruleId === "collision-branch";

function verdict(report: ScanReport): string {
  if (report.blockedBy === "secrets") return "❌ **Preflux: blocked** — secrets found in this change";
  if (report.decision === "block" && report.forced) return `⚠️ **Preflux: allowed (overridden)** — Push Safety Score ${report.score}/100`;
  if (report.decision === "block") return `❌ **Preflux: blocked** — Push Safety Score ${report.score}/100`;
  if (report.decision === "warn") return `⚠️ **Preflux: allowed with warnings** — Push Safety Score ${report.score}/100`;
  return `✅ **Preflux: all clear** — Push Safety Score ${report.score}/100`;
}

function moduleCell(report: ScanReport, name: keyof ScanReport["modules"], summary: string): string {
  const m = report.modules[name];
  return m.status === "ok" ? summary : `skipped${m.reason ? ` (${m.reason})` : ""}`;
}

export function renderMarkdown(report: ScanReport): string {
  const secrets = report.findings.filter((f) => f.kind === "secret");
  const risks = report.findings.filter((f) => f.kind === "bug_risk");
  const conflicts = report.findings.filter((f) => f.kind === "conflict" && !isRadar(f));
  const radar = report.findings.filter(isRadar);
  const riskyFiles = risks.filter((f) => f.severity !== "low");

  const out = [
    COMMENT_MARKER,
    `### ${verdict(report)}`,
    "",
    "| Check | Result |",
    "|---|---|",
    `| 🔑 Secrets | ${secrets.length === 0 ? "✅ none found" : `❌ ${secrets.length} found`} |`,
    `| 🐞 Bug risk | ${moduleCell(report, "bugRisk", riskyFiles.length === 0 ? `✅ ${risks.length} files, none risky` : `⚠️ ${riskyFiles.length} of ${risks.length} files need attention`)} |`,
    `| 🔀 Conflicts | ${moduleCell(report, "conflicts", conflicts.length + radar.length === 0 ? "✅ none" : [conflicts.length && `⚠️ ${conflicts.length} with the base branch`, radar.length && `👥 ${radar.length} team heads-up${radar.length === 1 ? "" : "s"}`].filter(Boolean).join(", "))} |`,
    "",
  ];

  if (secrets.length > 0) {
    out.push("**🔑 Secrets** — revoke them, move them to environment variables, and remove them from the commits:");
    for (const f of secrets) out.push(`- **${LEVEL[f.severity]}** ${f.message} in ${where(f)}`);
    out.push("");
  }
  if (riskyFiles.length > 0) {
    out.push("**🐞 Riskiest files** — worth an extra review or a test:");
    for (const f of riskyFiles.slice(0, 5)) {
      out.push(`- **${LEVEL[f.severity]}** ${where(f)} — ${f.message.replace(/^\w+ risk: /, "")}`);
      if (f.reasons?.length) out.push(`  <br><sub>why: ${f.reasons.join(" · ")}</sub>`);
    }
    out.push("");
  }
  if (conflicts.length + radar.length > 0) {
    out.push("**🔀 Conflicts**");
    for (const f of conflicts) out.push(`- **${LEVEL[f.severity]}** ${where(f)} — ${f.message}`);
    for (const f of radar) out.push(`- 👥 ${where(f)} — ${f.message}`);
    out.push("");
  }
  if (report.blockedBy === "score" && !report.forced) {
    out.push("_Sure it's fine? A maintainer can override this once with the action's `force` input (`PREFLUX_FORCE=1` when run locally)._", "");
  }
  out.push("<sub>Push Safety Score = 100 × (1 − (0.6 × bug risk + 0.4 × conflicts)). 70+ allows, 40–69 warns, below 40 blocks. Secrets always block.</sub>");
  return out.join("\n");
}
