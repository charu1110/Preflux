import { FEATURE_ORDER, type FeatureVector } from "@preflux/shared/ml";
import { afterEach, describe, expect, it } from "vitest";
import { predict } from "../src/api/mlClient.js";
import { deadUrl, startMlStub, type MlStub } from "./helpers/mlStub.js";

const features = Object.fromEntries(FEATURE_ORDER.map((f) => [f, 1])) as FeatureVector;
const rows = [
  { id: "r0", features: { ...features, la: 80 } },
  { id: "r1", features: { ...features, la: 10 } },
];

let stub: MlStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("ML client", () => {
  it("returns probabilities from the service", async () => {
    stub = await startMlStub();
    const r = await predict(`${stub.url}/`, rows, 2000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.rows.map((x) => [x.id, x.level])).toEqual([["r0", "high"], ["r1", "low"]]);
  });

  it("sends only ids and numeric features", async () => {
    stub = await startMlStub();
    await predict(stub.url, rows, 2000);
    const sent = JSON.parse(stub.requests[0]!);
    expect(Object.keys(sent)).toEqual(["rows"]);
    expect(Object.keys(sent.rows[0]).sort()).toEqual(["features", "id"]);
    expect(Object.values(sent.rows[0].features).every((v) => typeof v === "number")).toBe(true);
  });

  it("fails open when the service is down", async () => {
    const r = await predict(await deadUrl(), rows, 2000);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("not reachable") });
  });

  it("fails open on timeout", async () => {
    stub = await startMlStub((body) => ({ delayMs: 1500, body }));
    const r = await predict(stub.url, rows, 200);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("no answer within 200 ms") });
  });

  it("explains a missing model and bad responses", async () => {
    stub = await startMlStub(() => ({ status: 503, body: { detail: "no model" } }));
    expect(await predict(stub.url, rows, 2000)).toEqual({ ok: false, reason: "ML service has no trained model yet" });
    await stub.close();

    stub = await startMlStub(() => ({ body: "not json{" }));
    expect(await predict(stub.url, rows, 2000)).toEqual({ ok: false, reason: "ML service sent invalid JSON" });
    await stub.close();

    stub = await startMlStub(() => ({ body: { rows: [{ id: "zzz", probability: 0.5 }] } }));
    expect(await predict(stub.url, rows, 2000)).toEqual({ ok: false, reason: "ML service sent an unexpected response" });
  });
});
