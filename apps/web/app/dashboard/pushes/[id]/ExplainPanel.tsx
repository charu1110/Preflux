"use client";

import { useActionState } from "react";
import { explainPushAction, type FormState } from "../../actions";

interface Props {
  pushId: string;
  explanation: string | null;
  model: string | null;
  configured: boolean;
}

/** Shows the stored AI explanation, or a button to create it once. */
export default function ExplainPanel({ pushId, explanation, model, configured }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(explainPushAction, {});

  if (explanation) {
    return (
      <div className="flex flex-col gap-2">
        <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{explanation}</p>
        <p className="text-xs text-zinc-500">
          Written by AI ({model ?? "Claude"}) from this push&apos;s findings. Preflux made the decision; the AI only explains it.
        </p>
      </div>
    );
  }

  if (!configured) {
    return <p className="text-sm text-zinc-500">AI explanations are not set up on this server. The findings below explain the result.</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="push_id" value={pushId} />
      <p className="text-sm text-zinc-500">Get a short plain-English summary of this push and what to do next. Only the findings below are sent: never code or secret values.</p>
      <button disabled={pending} className="self-start rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60">
        {pending ? "Explaining…" : "✨ Explain with AI"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
