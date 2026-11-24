"use client";

import { useActionState, useState } from "react";
import { addMember, createToken, revokeToken, type FormState } from "../../actions";

export interface TokenRow {
  id: string;
  label: string;
  token_hint: string;
  created_at: string;
  last_used_at: string | null;
}

/** Create a project token (shown once) and see the exact command to connect a repository. */
export function TokenPanel({ projectId, tokens, dashboardUrl }: { projectId: string; tokens: TokenRow[]; dashboardUrl: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createToken, {});
  const [copied, setCopied] = useState(false);
  const command = state.token ? `preflux link ${state.token} --url ${dashboardUrl}` : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="project_id" value={projectId} />
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          Token name
          <input name="label" maxLength={40} placeholder="e.g. Charu's laptop, GitHub Action" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <button disabled={pending} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60">
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      {command && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">Copy this now: the token won&apos;t be shown again.</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">Run it inside the repository (after <code className="font-mono">preflux init</code>):</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100">{command}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(true))}
              className="rounded-md border border-amber-400 px-2 py-1 text-xs hover:bg-amber-100 dark:hover:bg-amber-900"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t.label}</span> <span className="font-mono text-zinc-500">pfx_…{t.token_hint}</span>
                <span className="block text-xs text-zinc-500">{t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleString()}` : "never used"}</span>
              </span>
              <form action={revokeToken}>
                <input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="token_id" value={t.id} />
                <button className="text-xs text-red-600 hover:underline">Revoke</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MemberPanel({ projectId, members, isOwner }: { projectId: string; members: Array<{ email: string; role: string }>; isOwner: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addMember, {});
  return (
    <div className="flex flex-col gap-3">
      <ul className="text-sm">
        {members.map((m) => (
          <li key={m.email} className="flex justify-between py-1">
            <span>{m.email}</span>
            <span className="text-zinc-500">{m.role}</span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <form action={action} className="flex gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input name="email" type="email" required placeholder="teammate@example.com" className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          <button disabled={pending} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Add
          </button>
        </form>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-600">{state.message}</p>}
    </div>
  );
}
