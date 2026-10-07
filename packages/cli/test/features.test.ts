import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FEATURE_ORDER, FIX_REGEX, type FeatureRow } from "@preflux/shared/ml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeEntropy, countLines, extractFeatures } from "../src/features/extract.js";

// Parity: the TypeScript extractor (used on every push) must produce exactly what the Python
// extractor (used to build the training set) wrote into fixtures/feature-repo.expected.json.

const FIXTURES = resolve(__dirname, "../../../fixtures");
const expected = JSON.parse(readFileSync(join(FIXTURES, "feature-repo.expected.json"), "utf8")) as FeatureRow[];

let dir: string;
let repo: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "preflux-features-"));
  repo = join(dir, "repo");
  execFileSync("git", ["clone", "-q", join(FIXTURES, "feature-repo.bundle"), repo]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("feature extraction parity with Python", () => {
  it("produces the same rows, in the same order, with the same values", () => {
    const { rows, truncated } = extractFeatures(["HEAD"], repo);
    expect(truncated).toBe(false);
    expect(rows.map((r) => `${r.commit} ${r.file}`)).toEqual(expected.map((r) => `${r.commit} ${r.file}`));

    rows.forEach((row, i) => {
      const want = expected[i]!.features;
      for (const name of FEATURE_ORDER) {
        expect(row.features[name], `${row.file} @ ${row.commit.slice(0, 7)}: ${name}`).toBeCloseTo(want[name], 6);
      }
    });
  });

  it("only extracts the commits being pushed, but uses the full prior history", () => {
    const { rows } = extractFeatures(["HEAD~2..HEAD"], repo);
    const tail = expected.filter((r) => rows.some((x) => x.commit === r.commit));
    expect(rows.map((r) => r.features)).toEqual(tail.map((r) => r.features));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("caps the number of rows, keeping the most recent changes", () => {
    const { rows, truncated } = extractFeatures(["HEAD"], repo, 4);
    expect(truncated).toBe(true);
    expect(rows.map((r) => r.features)).toEqual(expected.slice(-4).map((r) => r.features));
  });
});

describe("feature helpers", () => {
  it("counts lines like the Python extractor", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });

  it("computes normalised change entropy", () => {
    expect(changeEntropy([{ la: 5, ld: 0 }])).toBe(0);
    expect(changeEntropy([{ la: 5, ld: 0 }, { la: 3, ld: 2 }])).toBe(1);
  });

  it("recognises bug-fix commit subjects", () => {
    expect(FIX_REGEX.test("Fix discount percentage bug")).toBe(true);
    expect(FIX_REGEX.test("fixes #123: crash on empty input")).toBe(true);
    expect(FIX_REGEX.test("Add prefix handling")).toBe(false); // "prefix" must not match "fix"
    expect(FIX_REGEX.test("Debug logging")).toBe(false);
  });
});
