"use client";

import { useActionState } from "react";
import { createProject, type FormState } from "./actions";

export default function NewProjectForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createProject, {});
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Project name
        <input name="name" required maxLength={80} placeholder="Shop website" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Repository URL <span className="font-normal text-zinc-500">(optional)</span>
        <input name="repo_url" type="url" placeholder="https://github.com/you/repo" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <button disabled={pending} className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-60">
        {pending ? "Creating…" : "Create project"}
      </button>
      {state.error && <p className="text-sm text-red-600 sm:basis-full">{state.error}</p>}
    </form>
  );
}
