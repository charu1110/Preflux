// Small presentational pieces shared by the dashboard pages.

export type Decision = "allow" | "warn" | "block";

const DECISION_STYLE: Record<Decision, string> = {
  allow: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  block: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};
const DECISION_LABEL: Record<Decision, string> = { allow: "Allowed", warn: "Warned", block: "Blocked" };

export function DecisionPill({ decision, forced }: { decision: Decision; forced?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_STYLE[decision]}`}>
      {forced ? "Overridden" : DECISION_LABEL[decision]}
    </span>
  );
}

export function scoreColor(score: number | null): string {
  if (score === null) return "text-zinc-400";
  return score >= 70 ? "text-green-600" : score >= 40 ? "text-amber-600" : "text-red-600";
}

export function ScoreBadge({ score }: { score: number | null }) {
  return <span className={`font-mono font-semibold tabular-nums ${scoreColor(score)}`}>{score ?? "–"}</span>;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function SeverityTag({ severity, label }: { severity: string; label?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low}`}>
      {label ?? severity}
    </span>
  );
}

/** Timestamp (ms) of `days` days ago. Pages render per request, so "now" is the request time. */
export function daysAgo(days: number): number {
  return Date.now() - days * 86_400_000;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units: Array<[number, string]> = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [2592000, "month"],
  ];
  let [size, name] = units[0]!;
  for (const u of units) if (seconds >= u[0]) [size, name] = u;
  const n = Math.floor(seconds / size);
  return `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-200 p-5 dark:border-zinc-800 ${className}`}>
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>;
}
