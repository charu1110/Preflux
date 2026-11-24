import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { IngestPayload } from "@preflux/shared/ingest";
import { git } from "../git/exec.js";

// Connection to the team dashboard. The link lives in .git/preflux-link.json: inside the git
// directory, so the token can never be committed by accident. CI uses environment variables instead.

export interface DashboardLink {
  url: string;
  token: string;
}

export const TOKEN_PATTERN = /^pfx_[0-9a-f]{48}$/;

function linkPath(root: string): string {
  const p = git(["rev-parse", "--git-path", "preflux-link.json"], root).trim();
  return isAbsolute(p) ? p : join(root, p);
}

export function readLink(root: string, env: NodeJS.ProcessEnv = process.env): DashboardLink | null {
  if (env.PREFLUX_TOKEN && env.PREFLUX_DASHBOARD_URL) return { token: env.PREFLUX_TOKEN, url: env.PREFLUX_DASHBOARD_URL };
  const file = linkPath(root);
  if (!existsSync(file)) return null;
  try {
    const link = JSON.parse(readFileSync(file, "utf8")) as Partial<DashboardLink>;
    return link.url && link.token ? { url: link.url, token: link.token } : null;
  } catch {
    return null;
  }
}

export function writeLink(root: string, link: DashboardLink): string {
  const file = linkPath(root);
  writeFileSync(file, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export function removeLink(root: string): boolean {
  const file = linkPath(root);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export type UploadResult = { ok: true } | { ok: false; reason: string };

/** Send one push to the dashboard. Never throws: the push must not depend on the dashboard. */
export async function uploadPush(link: DashboardLink, payload: IngestPayload, timeoutMs = 4000): Promise<UploadResult> {
  try {
    const res = await fetch(`${link.url.replace(/\/+$/, "")}/api/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${link.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { ok: false, reason: "the project token was rejected (run preflux link again)" };
    if (!res.ok) return { ok: false, reason: `dashboard returned HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    const e = err as Error;
    return { ok: false, reason: e.name === "TimeoutError" ? "dashboard did not answer in time" : `dashboard not reachable at ${link.url}` };
  }
}
