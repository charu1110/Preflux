// Reports whether the dashboard can reach Supabase. Never returns keys, only a status.

type SupabaseStatus = "connected" | "not_configured" | "error" | "unreachable";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let supabase: SupabaseStatus;
  let reason: string | undefined;

  if (!url || !anonKey) {
    supabase = "not_configured";
  } else {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
        headers: { apikey: anonKey },
        cache: "no-store",
        // Free-tier projects can take several seconds to answer after idling.
        signal: AbortSignal.timeout(10_000),
      });
      supabase = res.ok ? "connected" : "error";
    } catch (err) {
      supabase = "unreachable";
      // Network error details help locally; production responses only carry the status.
      if (process.env.NODE_ENV !== "production") {
        const e = err as Error & { cause?: { code?: string; message?: string } };
        reason = e.cause?.code ?? e.cause?.message ?? e.message;
      }
    }
  }

  return Response.json({ supabase, reason, checkedAt: new Date().toISOString() });
}
