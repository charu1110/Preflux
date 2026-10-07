import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubReply {
  status?: number;
  body?: unknown;
  /** Delay before answering, to exercise client timeouts. */
  delayMs?: number;
}

export interface MlStub {
  url: string;
  /** Raw request bodies received on POST /predict. */
  requests: string[];
  close(): Promise<void>;
}

type Row = { id: string; features: Record<string, number> };

/** Default model: risk grows with lines added, so tests can predict the ranking. */
export function defaultReply(body: { rows: Row[] }): StubReply {
  return {
    body: {
      model_version: "stub-v1",
      threshold: 0.5,
      rows: body.rows.map((r) => {
        const probability = Math.min(0.95, (r.features.la ?? 0) / 100);
        return { id: r.id, probability, level: probability >= 0.5 ? "high" : probability >= 0.3 ? "medium" : "low" };
      }),
    },
  };
}

/** A tiny stand-in for the FastAPI service, listening on a random local port. */
export async function startMlStub(reply: (body: { rows: Row[] }) => StubReply = defaultReply): Promise<MlStub> {
  const requests: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(raw);
      const r = reply(JSON.parse(raw || "{}"));
      setTimeout(() => {
        res.writeHead(r.status ?? 200, { "content-type": "application/json" });
        res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A URL nothing listens on (connection refused). */
export async function deadUrl(): Promise<string> {
  const stub = await startMlStub();
  await stub.close();
  return stub.url;
}
