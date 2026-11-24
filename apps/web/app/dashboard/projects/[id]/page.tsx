import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createUserClient } from "@/lib/supabase/server";
import { Card, DecisionPill, Empty, ScoreBadge, SeverityTag, daysAgo, scoreColor, timeAgo, type Decision } from "../../_components/ui";
import { MemberPanel, TokenPanel, type TokenRow } from "./SetupPanels";

interface Push {
  id: string;
  branch: string | null;
  author: string | null;
  score: number | null;
  decision: Decision;
  blocked_by: string | null;
  forced: boolean;
  created_at: string;
}
interface FindingRow {
  kind: "secret" | "bug_risk" | "conflict";
  rule_id: string;
  severity: string;
  file: string;
  line: number | null;
  message: string;
  reasons: string[] | null;
  percentile: number | null;
  push_events: { created_at: string; branch: string | null; author: string | null } | null;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase.from("projects").select("id, name, repo_url, owner_id").eq("id", id).maybeSingle();
  if (!project) notFound();
  const isOwner = project.owner_id === user?.id;

  const [{ data: pushRows }, { data: findingRows }, { data: memberRows }, { data: tokenRows }] = await Promise.all([
    supabase.from("push_events").select("id, branch, author, score, decision, blocked_by, forced, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("findings")
      .select("kind, rule_id, severity, file, line, message, reasons, percentile, push_events(created_at, branch, author)")
      .eq("project_id", id)
      .order("id", { ascending: false })
      .limit(400),
    supabase.rpc("list_project_members", { p_project: id }),
    isOwner ? supabase.from("project_tokens").select("id, label, token_hint, created_at, last_used_at").eq("project_id", id).order("created_at") : Promise.resolve({ data: [] }),
  ]);

  const pushes = (pushRows ?? []) as Push[];
  const findings = (findingRows ?? []) as unknown as FindingRow[];
  const h = await headers();
  const dashboardUrl = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  // Headline numbers over the last 30 days.
  const monthAgo = daysAgo(30);
  const recent = pushes.filter((p) => new Date(p.created_at).getTime() >= monthAgo);
  const blocked = recent.filter((p) => p.decision === "block" && !p.forced).length;
  const warned = recent.filter((p) => p.decision === "warn").length;
  const scored = recent.filter((p) => p.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;
  const secretsCaught = findings.filter((f) => f.kind === "secret");

  // Files the model keeps flagging: how often, how risky at worst, and the latest reasons.
  const riskyFiles = new Map<string, { file: string; times: number; worst: number; reasons: string[] }>();
  for (const f of findings.filter((x) => x.kind === "bug_risk" && x.severity !== "low")) {
    const r = riskyFiles.get(f.file) ?? { file: f.file, times: 0, worst: 0, reasons: f.reasons ?? [] };
    r.times++;
    r.worst = Math.max(r.worst, f.percentile ?? 0);
    riskyFiles.set(f.file, r);
  }
  const topRisky = [...riskyFiles.values()].sort((a, b) => b.times - a.times || b.worst - a.worst).slice(0, 6);
  const conflicts = findings.filter((f) => f.kind === "conflict").slice(0, 8);
  const trend = pushes.slice(0, 30).reverse();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="text-sm text-violet-600 hover:underline">← All projects</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{project.name}</h1>
        {project.repo_url && <p className="text-sm text-zinc-500">{project.repo_url}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ["Pushes (30 days)", String(recent.length), ""],
          ["Blocked", String(blocked), blocked ? "text-red-600" : ""],
          ["Warned", String(warned), warned ? "text-amber-600" : ""],
          ["Average score", avg === null ? "–" : String(avg), scoreColor(avg)],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-500">{label}</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <Card title="Push Safety Score: last 30 pushes">
        {trend.length === 0 ? (
          <Empty>No pushes yet. Connect a repository below and push.</Empty>
        ) : (
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Score of each recent push, oldest to newest">
            {trend.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/pushes/${p.id}`}
                title={`${p.score ?? "–"}/100 · ${p.branch ?? ""} · ${timeAgo(p.created_at)}`}
                className={`flex-1 rounded-t ${p.decision === "block" ? "bg-red-500" : p.decision === "warn" ? "bg-amber-400" : "bg-green-500"} hover:opacity-80`}
                style={{ height: `${Math.max(4, p.score ?? 0)}%` }}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="🐞 Files that keep getting flagged">
          {topRisky.length === 0 ? (
            <Empty>No risky files flagged yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {topRisky.map((r) => (
                <li key={r.file}>
                  <div className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono">{r.file}</code>
                    <span className="shrink-0 text-zinc-500">{r.times}× · up to {Math.round(r.worst)}th pct</span>
                  </div>
                  {r.reasons.length > 0 && <p className="text-xs text-zinc-500">why: {r.reasons.join(" · ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="🔀 Conflicts & team heads-ups">
          {conflicts.length === 0 ? (
            <Empty>No conflicts with teammates&apos; work so far.</Empty>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {conflicts.map((c, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2">
                    <SeverityTag severity={c.severity} label={c.rule_id === "collision-branch" ? "team" : c.severity} />
                    <code className="truncate font-mono">{c.file}{c.line ? `:${c.line}` : ""}</code>
                  </div>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{c.message}</p>
                  {c.push_events && <p className="text-xs text-zinc-500">{c.push_events.author} · {c.push_events.branch} · {timeAgo(c.push_events.created_at)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`🔑 Secrets stopped before leaving a laptop (${secretsCaught.length})`}>
        {secretsCaught.length === 0 ? (
          <Empty>None so far.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {secretsCaught.slice(0, 8).map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <SeverityTag severity={s.severity} />
                <span>{s.message}</span>
                <code className="font-mono text-zinc-500">{s.file}{s.line ? `:${s.line}` : ""}</code>
                {s.push_events && <span className="text-xs text-zinc-500">{s.push_events.author} · {timeAgo(s.push_events.created_at)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent pushes">
        {pushes.length === 0 ? (
          <Empty>No pushes yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Branch</th>
                  <th className="py-2 pr-4 font-medium">Author</th>
                  <th className="py-2 pr-4 font-medium">Score</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {pushes.slice(0, 20).map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-4">
                      <Link href={`/dashboard/pushes/${p.id}`} className="text-violet-600 hover:underline">{timeAgo(p.created_at)}</Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{p.branch ?? "–"}</td>
                    <td className="py-2 pr-4">{p.author ?? "–"}</td>
                    <td className="py-2 pr-4"><ScoreBadge score={p.score} /></td>
                    <td className="py-2"><DecisionPill decision={p.decision} forced={p.forced} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {isOwner && (
          <Card title="Connect a repository">
            <TokenPanel projectId={id} tokens={(tokenRows ?? []) as TokenRow[]} dashboardUrl={dashboardUrl} />
          </Card>
        )}
        <Card title="Team">
          <MemberPanel projectId={id} members={(memberRows ?? []) as Array<{ email: string; role: string }>} isOwner={isOwner} />
        </Card>
      </div>
    </div>
  );
}
