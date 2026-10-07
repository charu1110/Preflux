import type { FeatureVector, PredictRequest, PredictResponse } from "@preflux/shared/ml";

export type PredictResult = { ok: true; data: PredictResponse } | { ok: false; reason: string };

/**
 * POST feature rows to the ML service. Never throws: any failure (refused, timeout, bad status,
 * malformed body) comes back as { ok: false } so the push carries on without bug risk.
 * Only numbers and opaque ids are sent; file paths and code stay on this machine.
 */
export async function predict(
  baseUrl: string,
  rows: Array<{ id: string; features: FeatureVector }>,
  timeoutMs: number,
): Promise<PredictResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/predict`;
  const body: PredictRequest = { rows };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    const why = e.name === "TimeoutError" ? `no answer within ${timeoutMs} ms` : "not reachable";
    return { ok: false, reason: `ML service ${why} at ${baseUrl}` };
  }

  if (res.status === 503) return { ok: false, reason: "ML service has no trained model yet" };
  if (!res.ok) return { ok: false, reason: `ML service returned HTTP ${res.status}` };

  try {
    const data = (await res.json()) as PredictResponse;
    const ids = new Set(rows.map((r) => r.id));
    if (!Array.isArray(data.rows) || data.rows.some((r) => !ids.has(r.id) || typeof r.probability !== "number")) {
      return { ok: false, reason: "ML service sent an unexpected response" };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "ML service sent invalid JSON" };
  }
}
