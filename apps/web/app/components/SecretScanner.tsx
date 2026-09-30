"use client";

import { maskLine, scanLine, type SecretHit } from "@preflux/shared/secrets";
import type { Severity } from "@preflux/shared";
import { useMemo, useState } from "react";

// Same detection code as the `preflux` CLI, running entirely in the browser.

interface LineFinding extends Omit<SecretHit, "secret"> {
  line: number;
  masked: string;
}

function scanText(text: string): LineFinding[] {
  const findings: LineFinding[] = [];
  text.split("\n").forEach((content, i) => {
    const hits = scanLine(content);
    if (hits.length === 0) return;
    const masked = maskLine(content, hits.map((h) => h.secret));
    // Drop the raw secret: the UI only ever holds the masked version.
    for (const h of hits) {
      findings.push({ ruleId: h.ruleId, message: h.message, severity: h.severity, entropy: h.entropy, line: i + 1, masked });
    }
  });
  return findings;
}

const rand = (n: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") =>
  Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

/** Fresh fake credentials on every click. Nothing here is a real key, and no full key literal exists in source. */
function exampleCode(): string {
  const upperDigits = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return [
    `import Stripe from "stripe";`,
    ``,
    `// ❌ hard-coded credentials`,
    `const stripe = new Stripe("${"sk_" + "live_"}${rand(24)}");`,
    `const AWS_ACCESS_KEY_ID = "${"AK" + "IA"}${rand(16, upperDigits)}";`,
    `const GITHUB_TOKEN = "${"gh" + "p_"}${rand(36)}";`,
    `db_password = "Tr0ub${rand(4)}&${rand(3)}"`,
    `DATABASE_URL=${"postgres"}://admin:${rand(16)}@db.internal:5432/app`,
    ``,
    `// ✅ safe: preflux leaves these alone`,
    `const apiKey = process.env.STRIPE_SECRET_KEY;`,
    `password = "your-password-here"`,
    `const lastCommit = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b";`,
    `const userId = "550e8400-e29b-41d4-a716-446655440000";`,
  ].join("\n");
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default function SecretScanner() {
  const [code, setCode] = useState("");
  const findings = useMemo(() => scanText(code), [code]);
  const hasInput = code.trim().length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="code" className="text-sm font-medium">
            Paste code, a config file or a .env
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCode(exampleCode())}
              className="whitespace-nowrap rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Load example
            </button>
            <button
              type="button"
              onClick={() => setCode("")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          placeholder={'const apiKey = "…"'}
          className="h-80 w-full resize-y rounded-lg border border-zinc-300 bg-zinc-50 p-3 font-mono text-[13px] leading-6 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="text-xs text-zinc-500">🔒 Scanning runs entirely in your browser. Nothing you paste is uploaded.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
        {!hasInput ? (
          <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Results appear here as you type. Click <span className="mx-1 font-medium">Load example</span> to see a blocked push.
          </div>
        ) : findings.length === 0 ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <p className="font-semibold text-green-800 dark:text-green-300">✔ PUSH ALLOWED</p>
            <p className="text-sm text-green-700 dark:text-green-400">No secrets found.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <p className="font-semibold text-red-800 dark:text-red-300">
                ✖ PUSH BLOCKED: {findings.length} secret{findings.length === 1 ? "" : "s"} found
              </p>
              <p className="text-sm text-red-700 dark:text-red-400">
                Rotate them, move them to environment variables, and remove them from every commit.
              </p>
            </div>
            <ul className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
              {findings.map((f, i) => (
                <li key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${SEVERITY_STYLE[f.severity]}`}>
                      {f.severity}
                    </span>
                    <code className="font-semibold">{f.ruleId}</code>
                    <span className="text-zinc-500">line {f.line}</span>
                    <span className="ml-auto text-xs text-zinc-500">{f.entropy.toFixed(2)} bits/char</span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{f.message}</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-900">
                    {f.masked}
                  </pre>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
