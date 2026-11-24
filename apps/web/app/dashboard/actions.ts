"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { explainPush } from "@/lib/ai/explain";
import { createUserClient } from "@/lib/supabase/server";

// All dashboard writes go through the signed-in user's client, so row-level security and the
// database functions' owner checks decide what is allowed, not this code.

export interface FormState {
  error?: string;
  message?: string;
  token?: string;
}

export async function createProject(_prev: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim();
  const repoUrl = String(form.get("repo_url") ?? "").trim();
  if (name.length < 1 || name.length > 80) return { error: "Give the project a name (up to 80 characters)." };
  if (repoUrl && !/^https?:\/\/\S+$/.test(repoUrl)) return { error: "Repository URL should start with https://" };

  const supabase = await createUserClient();
  const { data, error } = await supabase.from("projects").insert({ name, repo_url: repoUrl || null }).select("id").single();
  if (error || !data) return { error: error?.message ?? "Could not create the project." };
  redirect(`/dashboard/projects/${data.id}`);
}

export async function createToken(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get("project_id") ?? "");
  const label = String(form.get("label") ?? "").trim() || "default";
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("create_project_token", { p_project: projectId, p_label: label });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { token: data as string };
}

export async function revokeToken(form: FormData): Promise<void> {
  const projectId = String(form.get("project_id") ?? "");
  const supabase = await createUserClient();
  await supabase.from("project_tokens").delete().eq("id", String(form.get("token_id") ?? ""));
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function addMember(_prev: FormState, form: FormData): Promise<FormState> {
  const projectId = String(form.get("project_id") ?? "");
  const email = String(form.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter your teammate's email address." };
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("add_project_member", { p_project: projectId, p_email: email });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { message: `${email} can now see this project.` };
}

/** "Explain with AI" on a push page. Reading through the user's client means RLS decides who may ask. */
export async function explainPushAction(_prev: FormState, form: FormData): Promise<FormState> {
  const pushId = String(form.get("push_id") ?? "");
  const supabase = await createUserClient();
  const { data: push } = await supabase
    .from("push_events")
    .select("id, score, decision, blocked_by, forced, branch, ai_explanation")
    .eq("id", pushId)
    .maybeSingle();
  if (!push) return { error: "Push not found." };
  if (push.ai_explanation) return {}; // already explained: never pay twice

  const { data: rows, error: findingsError } = await supabase
    .from("findings")
    .select("kind, rule_id, severity, file, line, message, reasons")
    .eq("push_id", pushId)
    .order("id");
  if (findingsError) return { error: "Could not load this push's findings." };

  const result = await explainPush(
    { score: push.score, decision: push.decision, blockedBy: push.blocked_by, forced: push.forced, branch: push.branch },
    (rows ?? []).map((r) => ({ kind: r.kind, ruleId: r.rule_id, severity: r.severity, file: r.file, line: r.line, message: r.message, reasons: r.reasons })),
  );
  if (!result.ok) return { error: result.error };

  const { error } = await supabase.rpc("save_push_explanation", { p_push: pushId, p_text: result.text, p_model: result.model });
  if (error) return { error: "The explanation was written but could not be saved. Has 0002_ai_explanations.sql been run?" };
  revalidatePath(`/dashboard/pushes/${pushId}`);
  return {};
}
