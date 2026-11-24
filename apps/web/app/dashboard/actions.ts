"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
