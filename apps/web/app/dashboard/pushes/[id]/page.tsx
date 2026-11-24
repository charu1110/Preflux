import Link from "next/link";
import { notFound } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";
import { Card, DecisionPill, Empty, ScoreBadge, SeverityTag, timeAgo, type Decision } from "../../_components/ui";

interface FindingRow {
  id: number;
  kind: "secret" | "bug_risk" | "conflict";
  rule_id: string;
  severity: string;
  file: string;
  line: number | null;
  message: string;
  reasons: string[] | null;
}

const SECTIONS: Array<{ kind: FindingRow["kind"]; title: string; empty: string }> = [
  { kind: "secret", title: "🔑 Secrets", empty: "No secrets found." },
  { kind: "conflict", title: "🔀 Conflicts & team heads-ups", empty: "No conflicts." },
  { kind: "bug_risk", title: "🐞 Bug risk", empty: "Bug risk wasn't analysed for this push." },
];

export default async function PushPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createUserClient();
  const { data: push } = await supabase
    .from("push_events")
    .select("id, project_id, branch, head_sha, author, mode, score, decision, blocked_by, forced, bug_risk, conflict_risk, created_at, projects(name)")
    .eq("id", id)
    .maybeSingle();
  if (!push) notFound();
  const { data: rows } = await supabase.from("findings").select("id, kind, rule_id, severity, file, line, message, reasons").eq("push_id", id).order("id");
  const findings = (rows ?? []) as FindingRow[];
  const project = push.projects as unknown as { name: string } | null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/projects/${push.project_id}`} className="text-sm text-violet-600 hover:underline">← {project?.name ?? "Project"}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            Push Safety Score <ScoreBadge score={push.score} />
            <span className="text-zinc-400">/100</span>
          </h1>
          <DecisionPill decision={push.decision as Decision} forced={push.forced} />
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          {push.author ?? "unknown"} · <span className="font-mono">{push.branch ?? "–"}</span>
          {push.head_sha && <span className="font-mono"> @ {push.head_sha.slice(0, 7)}</span>} · {timeAgo(push.created_at)} · via {push.mode === "ci" ? "pull request check" : "git push"}
        </p>
        {push.blocked_by === null && push.score !== null && (
          <p className="mt-1 text-xs text-zinc-500">
            bug risk {push.bug_risk?.toFixed(2) ?? "n/a"} × 0.6 · conflicts {push.conflict_risk?.toFixed(2) ?? "n/a"} × 0.4
          </p>
        )}
      </div>

      {SECTIONS.map((s) => {
        const list = findings.filter((f) => f.kind === s.kind);
        return (
          <Card key={s.kind} title={`${s.title} (${list.length})`}>
            {list.length === 0 ? (
              <Empty>{s.empty}</Empty>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {list.map((f) => (
                  <li key={f.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityTag severity={f.severity} label={f.rule_id === "collision-branch" ? "team" : f.severity} />
                      <code className="font-mono">{f.file}{f.line ? `:${f.line}` : ""}</code>
                    </div>
                    <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{f.message}</p>
                    {f.reasons && f.reasons.length > 0 && <p className="text-xs text-zinc-500">why: {f.reasons.join(" · ")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
