"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "not_configured" | "error" | "unreachable";

const LABEL: Record<Status, { dot: string; text: string }> = {
  checking: { dot: "bg-zinc-400 animate-pulse", text: "Checking database…" },
  connected: { dot: "bg-green-500", text: "Database (Supabase) connected" },
  not_configured: { dot: "bg-amber-500", text: "Database not configured yet" },
  error: { dot: "bg-red-500", text: "Database returned an error" },
  unreachable: { dot: "bg-red-500", text: "Database unreachable" },
};

export default function SystemStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { supabase: Status }) => setStatus(d.supabase))
      .catch(() => setStatus("unreachable"));
  }, []);

  const { dot, text } = LABEL[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
