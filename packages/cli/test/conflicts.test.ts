import { describe, expect, it } from "vitest";
import { findConflicts, symbolChanges, type SideFile } from "../src/conflicts/compare.js";
import { fileStructure } from "../src/conflicts/symbols.js";

// Each case: base, ours and theirs versions of files, as a three-way merge would see them.

type Versions = Record<string, string | null>;

async function side(base: Versions, tip: Versions): Promise<SideFile[]> {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(tip)])].filter((p) => (base[p] ?? null) !== (tip[p] ?? null));
  return Promise.all(
    paths.map(async (path) => ({ path, base: await fileStructure(path, base[path] ?? null), side: await fileStructure(path, tip[path] ?? null) })),
  );
}

async function conflicts(base: Versions, ours: Versions, theirs: Versions, textConflicts: string[] = []) {
  return findConflicts(await side(base, { ...base, ...ours }), await side(base, { ...base, ...theirs }), {
    theirsLabel: "origin/main",
    textConflicts: new Set(textConflicts),
    theirsCommit: () => "abc1234 by Bob",
  });
}

const CALC_JS = `function total(items) {
  let sum = 0;
  for (const i of items) sum += i;
  return sum;
}

function average(items) {
  return items.length ? total(items) / items.length : 0;
}
`;

describe("symbol extraction", () => {
  it("finds JS functions, arrow functions, classes, methods and CommonJS assignments", async () => {
    const s = await fileStructure(
      "a.js",
      `export function a(x) { return x }
const b = (y, z) => y + z;
class Cart { add(item) { this.items.push(item) } static of() {} }
app.handle = function (req, res) { next() };
exports.util = async (q) => q;`,
    );
    expect([...s.symbols.keys()].sort()).toEqual(["Cart", "Cart.add", "Cart.of", "a", "app.handle", "b", "exports.util"]);
    expect(s.symbols.get("b")).toMatchObject({ kind: "function", params: "(y, z)", startLine: 2 });
    expect(s.calls.get("push")).toEqual([{ text: "this.items.push(item)", line: 3 }]);
  });

  it("finds classes defined as expressions (module.exports = class ..., const X = class ...)", async () => {
    const s = await fileStructure(
      "app.js",
      `module.exports = class Application extends Emitter {
  handleRequest (ctx, fn) { return fn(ctx) }
}
const Repo = class { find(id) { return id } }
exports.Plain = class { run() {} }`,
    );
    expect([...s.symbols.keys()].sort()).toEqual(["Application", "Application.handleRequest", "Repo", "Repo.find", "exports.Plain", "exports.Plain.run"]);
    expect(s.symbols.get("Application.handleRequest")).toMatchObject({ kind: "method", params: "(ctx, fn)", startLine: 2 });
  });

  it("finds TypeScript and Python symbols with qualified method names", async () => {
    const ts = await fileStructure("a.ts", `export class Repo { private find(id: string): User { return db.get(id) } }\nexport function save(u: User): void {}`);
    expect([...ts.symbols.keys()].sort()).toEqual(["Repo", "Repo.find", "save"]);
    expect(ts.symbols.get("Repo.find")?.params).toBe("(id: string)");

    const py = await fileStructure("a.py", `@cache\ndef total(items):\n    return sum(items)\n\nclass Cart:\n    def add(self, item):\n        self.items.append(item)\n`);
    expect([...py.symbols.keys()].sort()).toEqual(["Cart", "Cart.add", "total"]);
    expect(py.symbols.get("total")).toMatchObject({ startLine: 1, params: "(items)" });
  });

  it("classifies edits, signature changes, deletions, renames and additions", async () => {
    const changes = symbolChanges(
      (await side(
        { "c.js": CALC_JS },
        {
          "c.js": CALC_JS.replace("function total(items)", "function total(items, start)")
            .replace("function average(items) {", "function mean(items) {")
            .concat("\nfunction median(xs) { return xs[0] }\n"),
        },
      ))[0]!,
    );
    expect(changes.map((c) => [c.name, c.kind, c.renamedTo])).toEqual([
      ["total", "signature", undefined],
      ["average", "renamed", "mean"],
      ["median", "added", undefined],
    ]);
  });
});

describe("structural conflict rules", () => {
  it("R1: same function edited on both sides in non-overlapping lines (Git merges silently)", async () => {
    const ours = CALC_JS.replace("let sum = 0;", "let sum = 0; // start");
    const theirs = CALC_JS.replace("return sum;", "return Math.round(sum);");
    const found = await conflicts({ "calc.js": CALC_JS }, { "calc.js": ours }, { "calc.js": theirs });
    expect(found).toEqual([
      expect.objectContaining({ kind: "conflict", ruleId: "conflict-same-function", severity: "high", file: "calc.js", line: 1 }),
    ]);
    expect(found[0]!.message).toContain("total() was also edited on origin/main (abc1234 by Bob)");
    expect(found[0]!.message).toContain("merge them silently");
  });

  it("R1 is medium when Git will flag a text conflict anyway", async () => {
    const found = await conflicts(
      { "calc.js": CALC_JS },
      { "calc.js": CALC_JS.replace("return sum;", "return sum + 1;") },
      { "calc.js": CALC_JS.replace("return sum;", "return sum - 1;") },
      ["calc.js"],
    );
    expect(found.map((f) => [f.ruleId, f.severity])).toEqual([["conflict-same-function", "medium"]]);
  });

  it("no conflict when different functions are edited, or both sides make the identical edit", async () => {
    expect(
      await conflicts(
        { "calc.js": CALC_JS },
        { "calc.js": CALC_JS.replace("let sum = 0;", "let sum = 0; // start") },
        { "calc.js": CALC_JS.replace(": 0;", ": NaN;") },
      ),
    ).toEqual([]);
    const same = CALC_JS.replace("return sum;", "return sum * 1;");
    expect(await conflicts({ "calc.js": CALC_JS }, { "calc.js": same }, { "calc.js": same })).toEqual([]);
  });

  it("R2: their side changes a signature while our side adds calls in another file", async () => {
    const found = await conflicts(
      { "calc.js": CALC_JS, "cart.js": "function checkout(c) { return 0 }\n" },
      { "cart.js": "function checkout(c) { return total(c.items) }\n" },
      { "calc.js": CALC_JS.replace("function total(items)", "function total(items, currency)") },
    );
    expect(found).toEqual([
      expect.objectContaining({ ruleId: "conflict-changed-api", severity: "high", file: "cart.js", line: 1 }),
    ]);
    expect(found[0]!.message).toBe("origin/main changed the parameters of total() in calc.js (abc1234 by Bob), but your branch adds new calls to it");
  });

  it("R2 reversed: we rename a function that their side starts calling", async () => {
    const found = await conflicts(
      { "calc.py": "def total(items):\n    return sum(items)\n", "report.py": "def report(x):\n    return x\n" },
      { "calc.py": "def grand_total(items):\n    return sum(items)\n" },
      { "report.py": "def report(x):\n    return total(x)\n" },
    );
    expect(found.map((f) => [f.ruleId, f.file])).toEqual([["conflict-changed-api", "calc.py"]]);
    expect(found[0]!.message).toBe("You renamed total() to grand_total(), but origin/main adds new calls to it (report.py:2)");
  });

  it("R3: a function deleted on one side and edited on the other", async () => {
    const found = await conflicts(
      { "calc.js": CALC_JS },
      { "calc.js": CALC_JS.replace("return items.length", "return items && items.length") },
      { "calc.js": CALC_JS.slice(0, CALC_JS.indexOf("function average")) },
    );
    expect(found).toEqual([expect.objectContaining({ ruleId: "conflict-removed-vs-edited", severity: "high", line: 7 })]);
    expect(found[0]!.message).toBe("origin/main removed average() (abc1234 by Bob), but your branch edits it");
  });

  it("R4: both sides add a different function with the same name", async () => {
    const found = await conflicts(
      { "calc.js": CALC_JS },
      { "calc.js": `${CALC_JS}\nfunction median(xs) { return xs[0] }\n` },
      { "calc.js": `${CALC_JS}\nfunction median(xs) { return xs[xs.length >> 1] }\n` },
    );
    expect(found.map((f) => [f.ruleId, f.severity])).toEqual([["conflict-duplicate-definition", "medium"]]);
  });

  it("ignores generic method names to avoid false alarms", async () => {
    const found = await conflicts(
      { "store.js": "class Store { get(k) { return this.m[k] } }\n", "app.js": "function f(m) { return 1 }\n" },
      { "app.js": "function f(m) { return m.get('a') }\n" },
      { "store.js": "class Store { get(k, fallback) { return this.m[k] ?? fallback } }\n" },
    );
    expect(found).toEqual([]);
  });

  it("reports plain text conflicts in files without structural findings", async () => {
    const found = await conflicts({ "README.md": "a" }, { "README.md": "b" }, { "README.md": "c" }, ["README.md"]);
    expect(found).toEqual([expect.objectContaining({ ruleId: "conflict-text", severity: "medium", file: "README.md", line: undefined })]);
  });
});
