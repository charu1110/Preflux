"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  message?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(form: FormData): { email: string; password: string } | { error: string } {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  return { email, password };
}

/** Turn Supabase auth errors into messages a user can act on. */
function friendly(error: { message: string; name?: string; status?: number }): string {
  if (error.name === "AuthRetryableFetchError" || error.message === "fetch failed" || error.status === 0) {
    return "Can't reach the login service right now. Check your connection and try again.";
  }
  if (error.message === "Invalid login credentials") return "Wrong email or password.";
  if (error.message === "Email not confirmed") return "Please confirm your email first (check your inbox).";
  return error.message;
}

/** Only allow redirects inside the dashboard (no open redirects via ?next=). */
const safeNext = (next: FormDataEntryValue | null) => {
  const n = String(next ?? "");
  return n.startsWith("/dashboard") ? n : "/dashboard";
};

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const creds = readCredentials(form);
  if ("error" in creds) return creds;
  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) return { error: friendly(error) };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const creds = readCredentials(form);
  if ("error" in creds) return creds;
  const supabase = await createUserClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signUp({ ...creds, options: { emailRedirectTo: `${origin}/dashboard` } });
  if (error) return { error: friendly(error) };
  if (data.session) redirect("/dashboard");
  return { message: "Account created. Check your email to confirm it, then sign in." };
}

export async function signOut(): Promise<void> {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect("/login");
}
