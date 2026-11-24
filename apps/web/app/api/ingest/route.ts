import { validateIngestPayload } from "@preflux/shared/ingest";
import { createAnonClient } from "@/lib/supabase/server";

// POST /api/ingest: the CLI uploads one push here, authenticated with a project token.
// The database function ingest_push() checks the token (hashed) and stores the push.

const TOKEN = /^Bearer (pfx_[0-9a-f]{48})$/;
const MAX_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const token = TOKEN.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return Response.json({ error: "missing or malformed project token" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  const problem = validateIngestPayload(body);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const { data, error } = await createAnonClient().rpc("ingest_push", { p_token: token, p_push: body });
  if (error) {
    if (error.code === "28000") return Response.json({ error: "invalid project token" }, { status: 401 });
    return Response.json({ error: "could not store the push" }, { status: 500 });
  }
  return Response.json({ pushId: data }, { status: 201 });
}
