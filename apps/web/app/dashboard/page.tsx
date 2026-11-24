import Link from "next/link";
import { createUserClient } from "@/lib/supabase/server";
import NewProjectForm from "./NewProjectForm";
import { Card, DecisionPill, Empty, ScoreBadge, timeAgo, type Decision } from "./_components/ui";

export const metadata = { title: "Dashboard · Preflux" };

interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
}
interface PushRow {
  project_id: string;
  score: number | null;
  decision: Decision;
  forced: boolean;
  created_at: string;
}

export default async function DashboardHome() {
  const supabase = await createUserClient();
  const [{ data: projects, error }, { data: pushes }] = await Promise.all([
    supabase.from("projects").select("id, name, repo_url").order("created_at", { ascending: false }),
    supabase.from("push_events").select("project_id, score, decision, forced, created_at").order("created_at", { ascending: false }).limit(500),
  ]);

  if (error) {
    return (
      <Card title="Can't load your projects">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {error.message.includes("fetch failed") ? (
            "Can't reach the database right now. Check your connection, or whether the Supabase project is paused."
          ) : (
            <>
              {error.message}. If this is a new Supabase project, run <code className="font-mono">supabase/migrations/0001_preflux.sql</code> in the Supabase SQL Editor first.
            </>
          )}
        </p>
      </Card>
    );
  }

  const byProject = new Map<string, PushRow[]>();
  for (const p of (pushes ?? []) as PushRow[]) byProject.set(p.project_id, [...(byProject.get(p.project_id) ?? []), p]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your projects</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Every push checked by Preflux shows up here, for the whole team.</p>
      </div>

      {(projects ?? []).length === 0 ? (
        <Card>
          <Empty>No projects yet. Create one below, then connect a repository with <code className="font-mono">preflux link</code>.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(projects as ProjectRow[]).map((p) => {
            const list = byProject.get(p.id) ?? [];
            const last = list[0];
            const blocked = list.filter((x) => x.decision === "block" && !x.forced).length;
            return (
              <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="rounded-xl border border-zinc-200 p-5 transition hover:border-violet-400 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  {last && <DecisionPill decision={last.decision} forced={last.forced} />}
                </div>
                {p.repo_url && <p className="mt-0.5 truncate text-xs text-zinc-500">{p.repo_url.replace(/^https?:\/\//, "")}</p>}
                <div className="mt-4 flex items-end justify-between text-sm">
                  <div>
                    <p className="text-zinc-500">Last score</p>
                    <p className="text-2xl">
                      <ScoreBadge score={last?.score ?? null} />
                    </p>
                  </div>
                  <div className="text-right text-zinc-500">
                    <p>{list.length} push{list.length === 1 ? "" : "es"} · {blocked} blocked</p>
                    <p>{last ? timeAgo(last.created_at) : "no pushes yet"}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Card title="New project">
        <NewProjectForm />
      </Card>
    </div>
  );
}
