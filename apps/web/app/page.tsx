import SecretScanner from "./components/SecretScanner";
import SystemStatus from "./components/SystemStatus";

const STEPS = [
  { title: "You run git push", body: "The preflux pre-push hook starts automatically. There's nothing new to learn." },
  { title: "Preflux scans locally", body: "Every commit in the push is checked on your machine, before any network call." },
  { title: "It gives a verdict", body: "Secrets always block the push. Soon, bug risk and conflict risk will feed a Push Safety Score." },
  { title: "You get a clear fix", body: "Which file, which line, a masked preview, and exactly how to clean it up." },
];

const FEATURES = [
  {
    name: "Secret detection",
    status: "live" as const,
    body: "16 known key formats (AWS, GitHub, Stripe, OpenAI…) plus Shannon-entropy analysis for unknown secrets.",
  },
  {
    name: "Bug-risk prediction",
    status: "Phase 2",
    body: "An XGBoost model trained on real Git history (SZZ-labelled) estimates how likely a change is to introduce a defect.",
  },
  {
    name: "Structural conflict detection",
    status: "Phase 3",
    body: "Tree-sitter ASTs spot logic-level conflicts with the remote branch that line-based diffs miss.",
  },
  {
    name: "Push Safety Score + AI explanations",
    status: "Phase 4",
    body: "One 0–100 score per push. An LLM explains findings in plain English, but never makes the decision.",
  },
  {
    name: "Team dashboard",
    status: "Phase 5",
    body: "Repository health, bug-risk trends and an audit trail of blocked and allowed pushes, per project.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold tracking-tight">
            <span className="text-violet-600">pre</span>flux
          </span>
          <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <a href="#try" className="hover:text-violet-600">Try it</a>
            <a href="#how" className="hover:text-violet-600">How it works</a>
            <a href="#roadmap" className="hover:text-violet-600">Roadmap</a>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <p className="mb-4 inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            Pre-push code security &amp; risk analysis
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Stop leaked secrets <span className="text-violet-600">before</span> they leave your laptop.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            Most tools catch exposed API keys after they reach GitHub, when it&apos;s already too late. Preflux runs on{" "}
            <code className="rounded bg-zinc-100 px-1 font-mono text-base dark:bg-zinc-800">git push</code> and blocks the
            push on your machine.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#try" className="rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-700">
              Try the scanner
            </a>
            <a
              href="#how"
              className="rounded-lg border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              How it works
            </a>
          </div>
        </section>

        <section id="try" className="border-y border-zinc-200 bg-zinc-50/60 py-16 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">Try it: live secret scanner</h2>
            <p className="mt-2 mb-8 max-w-2xl text-zinc-600 dark:text-zinc-400">
              This is the same detection engine the <code className="font-mono">preflux</code> CLI runs on every push.
            </p>
            <SecretScanner />
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 overflow-x-auto rounded-xl bg-zinc-950 p-5 font-mono text-sm leading-7 text-zinc-100">
            <p className="text-zinc-500"># install the hook in any repository</p>
            <p>
              <span className="text-violet-400">$</span> preflux init
            </p>
            <p className="text-zinc-500"># from now on, every push is checked</p>
            <p>
              <span className="text-violet-400">$</span> git push
            </p>
            <p className="text-red-400">✖ secrets 1 found</p>
            <p className="pl-4 text-zinc-300">CRITICAL aws-access-key-id config.js:1</p>
            <p className="pl-4 text-zinc-500">&gt; accessKeyId: &quot;AKIA********(20 chars)&quot;</p>
            <p className="text-red-400">PUSH BLOCKED</p>
          </div>
        </section>

        <section id="roadmap" className="border-t border-zinc-200 py-16 dark:border-zinc-800">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-2xl font-bold tracking-tight">What Preflux checks</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.name} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{f.name}</h3>
                    {f.status === "live" ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                        ● Live
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {f.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>B.Tech CSE Major Project · Guru Nanak Dev Engineering College, Ludhiana · Charu, Bhumi, Aditi Kaushal</p>
          <SystemStatus />
        </div>
      </footer>
    </div>
  );
}
