import chalk from "chalk";
import type { Finding, ModuleName, ScanReport, Severity } from "@preflux/shared";

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow.bold,
  low: chalk.gray,
};

const MODULE_LABEL: Record<ModuleName, string> = {
  secrets: "secrets",
  bugRisk: "bug risk",
  conflicts: "conflicts",
};

function formatFinding(f: Finding): string {
  const where = `${f.file}${f.line ? `:${f.line}` : ""}`;
  const commit = f.commit && f.commit !== "STAGED" ? chalk.gray(` (commit ${f.commit.slice(0, 7)})`) : "";
  const lines = [
    `    ${SEVERITY_COLOR[f.severity](` ${f.severity.toUpperCase()} `)} ${chalk.bold(f.ruleId)}  ${chalk.cyan(where)}${commit}`,
    `      ${f.message}`,
  ];
  if (f.maskedSnippet) lines.push(chalk.gray(`      > ${f.maskedSnippet}`));
  if (f.fingerprint) lines.push(chalk.gray(`      fingerprint ${f.fingerprint}`));
  return lines.join("\n");
}

const TOP_RISKS = 5;
const RISK_COLOR: Partial<Record<Severity, (s: string) => string>> = {
  high: chalk.red.bold,
  medium: chalk.yellow.bold,
  low: chalk.green,
};

function formatRisk(f: Finding): string {
  const level = (f.severity === "high" ? "HIGH" : f.severity === "medium" ? "MED " : "LOW ").padEnd(4);
  const color = RISK_COLOR[f.severity] ?? chalk.gray;
  // Prefer "riskier than X% of past changes": easier to read than a raw probability.
  const how =
    f.percentile !== undefined
      ? `riskier than ${Math.round(f.percentile)}% of past changes`
      : `${Math.round((f.probability ?? 0) * 100)}% chance of a bug`;
  const lines = [`     ${color(level)}  ${chalk.cyan(f.file)}  ${chalk.gray(how)}`];
  if (f.reasons && f.reasons.length > 0) lines.push(chalk.gray(`           why: ${f.reasons.join(" · ")}`));
  else if (f.severity !== "low") lines.push(chalk.gray("           why: several small factors together"));
  return lines.join("\n");
}

const isRadar = (f: Finding) => f.ruleId === "collision-branch";

function formatConflict(f: Finding): string {
  const where = `${f.file}${f.line ? `:${f.line}` : ""}`;
  if (isRadar(f)) return [`     ${chalk.cyan("TEAM")}  ${chalk.cyan(where)}  ${chalk.gray("heads-up")}`, `           ${f.message}`].join("\n");
  const color = RISK_COLOR[f.severity] ?? chalk.gray;
  const level = (f.severity === "high" ? "HIGH" : f.severity === "medium" ? "MED " : "LOW ").padEnd(4);
  return [`     ${color(level)}  ${chalk.cyan(where)}  ${chalk.gray(f.ruleId.replace(/^conflict-/, ""))}`, `           ${f.message}`].join("\n");
}

function formatScore(report: ScanReport): string {
  const score = report.score ?? 0;
  const color = report.decision === "block" ? chalk.red.bold : report.decision === "warn" ? chalk.yellow.bold : chalk.green.bold;
  const part = (label: string, v: number | null | undefined) => (v === null || v === undefined ? `${label} n/a` : `${label} ${v.toFixed(2)}`);
  const b = report.scoreBreakdown;
  const detail =
    report.blockedBy === "secrets" ? "secrets found" : `${part("bug risk", b?.bugRisk)} × 0.6 · ${part("conflicts", b?.conflictRisk)} × 0.4`;
  return `  ${chalk.bold("Push Safety Score")}  ${color(`${score}/100`)}  ${chalk.gray(`(${detail})`)}`;
}

/** One-line reasons behind a warning or a score-based block. */
/** `git pull --rebase <remote> <branch>` for the base branch the conflict check actually used (e.g. origin master). */
export function pullCommand(report: ScanReport): string {
  const m = /compared with ([^/\s]+)\/([^\s;]+)/.exec(report.modules.conflicts?.reason ?? "");
  return `git pull --rebase ${m ? `${m[1]} ${m[2]}` : "origin main"}`;
}

function highlights(report: ScanReport): string[] {
  const out: string[] = [];
  const high = report.findings.filter((f) => f.kind === "bug_risk" && f.severity === "high").length;
  if (high > 0) out.push(`${high} high bug-risk file${high === 1 ? "" : "s"}: worth an extra review or a test before merging.`);
  const conflicts = report.findings.filter((f) => f.kind === "conflict" && !isRadar(f)).length;
  if (conflicts > 0) {
    out.push(`${conflicts} possible merge conflict${conflicts === 1 ? "" : "s"} with the base branch: coordinate with your teammates before merging.`);
  }
  const radar = report.findings.filter(isRadar).length;
  if (radar > 0) out.push(`${radar} team heads-up${radar === 1 ? "" : "s"}: teammates are changing the same code on unmerged branches.`);
  return out;
}

export function renderReport(report: ScanReport): string {
  const out: string[] = [];
  const commits = report.ranges.reduce((n, r) => n + r.commits, 0);
  const scope =
    report.mode === "staged" ? "staged changes" : `${commits} commit${commits === 1 ? "" : "s"} (${report.ranges.map((r) => r.label).join(", ")})`;
  out.push("", `${chalk.bold.magenta("preflux")} ${chalk.gray("▸")} scanned ${scope}`, "");

  const secrets = report.findings.filter((f) => f.kind === "secret");
  for (const name of Object.keys(report.modules) as ModuleName[]) {
    const m = report.modules[name];
    const label = MODULE_LABEL[name].padEnd(10);
    if (m.status === "skipped") {
      out.push(chalk.gray(`  –  ${label} skipped${m.reason ? ` (${m.reason})` : ""}`));
    } else if (m.status === "error") {
      out.push(chalk.red(`  !  ${label} error: ${m.reason ?? "unknown"}`));
    } else if (name === "secrets") {
      out.push(
        secrets.length === 0
          ? chalk.green(`  ✔  ${label} none found`)
          : chalk.red.bold(`  ✖  ${label} ${secrets.length} found`),
      );
      for (const f of secrets) out.push(formatFinding(f));
    } else if (name === "bugRisk") {
      const risks = report.findings.filter((f) => f.kind === "bug_risk");
      const note = m.reason ? chalk.gray(` (${m.reason})`) : "";
      out.push(`  ${chalk.cyan("◆")}  ${label} ${risks.length} file${risks.length === 1 ? "" : "s"} analysed${note}`);
      for (const f of risks.slice(0, TOP_RISKS)) out.push(formatRisk(f));
      if (risks.length > TOP_RISKS) out.push(chalk.gray(`       … ${risks.length - TOP_RISKS} more (see --json)`));
    } else if (name === "conflicts") {
      const conflicts = report.findings.filter((f) => f.kind === "conflict");
      const note = m.reason ? chalk.gray(` (${m.reason})`) : "";
      if (conflicts.length === 0) {
        out.push(chalk.green(`  ✔  ${label} none found`) + note);
      } else {
        out.push(chalk.yellow.bold(`  ⚠  ${label} ${conflicts.length} possible conflict${conflicts.length === 1 ? "" : "s"}`) + note);
        for (const f of conflicts) out.push(formatConflict(f));
      }
    }
  }
  out.push("");
  if (report.score !== null) out.push(formatScore(report), "");

  if (report.blockedBy === "secrets") {
    out.push(chalk.bgRed.white.bold(" PUSH BLOCKED ") + chalk.red.bold(" secrets detected in the commits being pushed."));
    out.push(
      "",
      chalk.bold("  How to fix:"),
      "   1. Treat the secret as leaked: revoke / rotate it with the provider.",
      "   2. Move it to an environment variable or secret manager (e.g. .env.local, which is git-ignored).",
      "   3. Remove it from every commit being pushed, not just the latest one:",
      chalk.gray("        git commit --amend        (if it is in the last commit)"),
      chalk.gray("        git rebase -i <base>      (if it is in an older commit)"),
      "",
      chalk.bold("  False positive?"),
      `   add ${chalk.cyan("fingerprint:<id>")} to .prefluxignore, or a ${chalk.cyan("preflux:allow")} comment on that line.`,
      chalk.gray("   Emergency bypass (not recommended): git push --no-verify"),
      "",
    );
  } else if (report.decision === "block" && !report.forced) {
    out.push(chalk.bgRed.white.bold(" PUSH BLOCKED ") + chalk.red.bold(` Push Safety Score ${report.score}/100 is too low.`));
    out.push(
      "",
      chalk.bold("  How to fix:"),
      ...highlights(report).map((h) => `   • ${h}`),
      `   • Bring in your team's latest work and resolve the clashes first, e.g.  ${pullCommand(report)}`,
      "   • Split very large changes into smaller commits, and add tests for the risky files.",
      "",
      chalk.bold("  Sure it's fine?"),
      `   Override once (recorded):  ${chalk.cyan("$env:PREFLUX_FORCE=1; git push")}   ${chalk.gray("(PowerShell)")}`,
      `                              ${chalk.cyan("PREFLUX_FORCE=1 git push")}          ${chalk.gray("(bash)")}`,
      "",
    );
  } else if (report.forced) {
    out.push(
      chalk.bgYellow.black.bold(" PUSH ALLOWED (FORCED) ") + chalk.yellow(` Push Safety Score ${report.score}/100 would have blocked this push.`),
      "",
    );
  } else if (report.decision === "warn") {
    out.push(chalk.bgYellow.black.bold(" PUSH ALLOWED WITH WARNINGS ") + chalk.yellow(` Push Safety Score ${report.score}/100.`), "");
    for (const h of highlights(report)) out.push(chalk.yellow(`  ⚠ ${h}`));
    out.push("");
  } else {
    out.push(chalk.bgGreen.black.bold(" PUSH ALLOWED ") + chalk.green(" no secrets found."), "");
    const notes = highlights(report);
    for (const h of notes) out.push(chalk.yellow(`  ⚠ ${h}`));
    if (notes.length > 0) out.push("");
  }
  return out.join("\n");
}
