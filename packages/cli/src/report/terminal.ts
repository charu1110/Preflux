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
    }
  }
  out.push("");

  if (report.decision === "block") {
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
  } else {
    out.push(chalk.bgGreen.black.bold(" PUSH ALLOWED ") + chalk.green(" no secrets found."), "");
  }
  return out.join("\n");
}
