import type { Finding, Severity } from "@preflux/shared";
import { simpleName, type CodeSymbol, type FileStructure } from "./symbols.js";

// Structural (logic-level) conflict rules. Pure functions: given the base, ours and theirs
// structure of every changed file, report what a line-based merge would miss.

/** One file changed on one side since the merge base. */
export interface SideFile {
  path: string;
  base: FileStructure;
  side: FileStructure;
}

export type ChangeKind = "modified" | "signature" | "deleted" | "renamed" | "added";

export interface SymbolChange {
  file: string;
  name: string;
  kind: ChangeKind;
  /** The symbol after the change (before it, for deletions and renames). */
  symbol: CodeSymbol;
  renamedTo?: string;
}

export interface AddedCall {
  file: string;
  name: string;
  line: number;
}

export interface CompareContext {
  /** e.g. "origin/main". */
  theirsLabel: string;
  /** Files Git itself would report as a text conflict. */
  textConflicts: Set<string>;
  /** e.g. "3f2a1c9 by Bob": who last changed the file on their side. */
  theirsCommit(file: string): string | undefined;
}

/** What changed, symbol by symbol, between base and side. */
export function symbolChanges(f: SideFile): SymbolChange[] {
  const changes: SymbolChange[] = [];
  const { symbols: base } = f.base;
  const { symbols: side } = f.side;
  const added = [...side.values()].filter((s) => !base.has(s.name));
  const consumed = new Set<string>();

  for (const s of side.values()) {
    const b = base.get(s.name);
    if (!b || s.kind === "class") continue; // class edits show up as method edits
    if (b.params !== s.params) changes.push({ file: f.path, name: s.name, kind: "signature", symbol: s });
    else if (b.body !== s.body) changes.push({ file: f.path, name: s.name, kind: "modified", symbol: s });
  }
  for (const b of base.values()) {
    if (side.has(b.name)) continue;
    // Same kind and identical body under a new name = rename.
    const twin = added.find((a) => !consumed.has(a.name) && a.kind === b.kind && a.body === b.body && a.params === b.params);
    if (twin) {
      consumed.add(twin.name);
      changes.push({ file: f.path, name: b.name, kind: "renamed", symbol: b, renamedTo: twin.name });
    } else {
      changes.push({ file: f.path, name: b.name, kind: "deleted", symbol: b });
    }
  }
  for (const a of added) {
    if (!consumed.has(a.name)) changes.push({ file: f.path, name: a.name, kind: "added", symbol: a });
  }
  return changes;
}

/**
 * New call sites: calls whose exact text appears more often on the side than in the base.
 * Matching by text (not line number) means unrelated edits that shift lines don't count.
 */
export function addedCalls(f: SideFile): AddedCall[] {
  const out: AddedCall[] = [];
  for (const [name, sites] of f.side.calls) {
    const remaining = new Map<string, number>();
    for (const b of f.base.calls.get(name) ?? []) remaining.set(b.text, (remaining.get(b.text) ?? 0) + 1);
    for (const site of sites) {
      const left = remaining.get(site.text) ?? 0;
      if (left > 0) remaining.set(site.text, left - 1);
      else out.push({ file: f.path, name, line: site.line });
    }
  }
  return out;
}

// Method and function names too generic to match across files by name alone.
const GENERIC_NAMES = new Set([
  "get", "set", "has", "add", "map", "filter", "reduce", "find", "push", "pop", "call", "apply", "bind",
  "then", "catch", "log", "init", "run", "main", "render", "toString", "update", "delete", "remove", "send",
  "emit", "on", "use", "next", "len", "str", "int", "print", "append", "format", "join", "split",
]);

const isEdit = (c: SymbolChange) => c.kind === "modified" || c.kind === "signature";
const isRemoval = (c: SymbolChange) => c.kind === "deleted" || c.kind === "renamed";
const display = (s: CodeSymbol) => (s.kind === "class" ? s.name : `${s.name}()`);

function apiChange(c: SymbolChange): string {
  if (c.kind === "signature") return `changed the parameters of ${display(c.symbol)}`;
  if (c.kind === "renamed") return `renamed ${display(c.symbol)} to ${c.renamedTo}()`;
  return `removed ${display(c.symbol)}`;
}

/** Calls on the other side that would hit a changed/removed symbol. */
function callersOf(c: SymbolChange, calls: AddedCall[]): AddedCall[] {
  if (c.symbol.kind === "class" && c.kind === "signature") return [];
  const name = simpleName(c.name);
  if (name.length < 3 || GENERIC_NAMES.has(name)) return [];
  // Methods are usually called through `this`/`self`: only trust same-file call sites for them.
  return calls.filter((call) => call.name === name && (c.symbol.kind !== "method" || call.file === c.file));
}

export function findConflicts(ours: SideFile[], theirs: SideFile[], ctx: CompareContext): Finding[] {
  const oursChanges = ours.flatMap(symbolChanges);
  const theirsChanges = theirs.flatMap(symbolChanges);
  const oursCalls = ours.flatMap(addedCalls);
  const theirsCalls = theirs.flatMap(addedCalls);
  const theirsByKey = new Map(theirsChanges.map((c) => [`${c.file}\0${c.name}`, c]));

  const findings = new Map<string, Finding>();
  const add = (ruleId: string, severity: Severity, file: string, line: number, key: string, message: string) => {
    const id = `${ruleId}\0${file}\0${key}`;
    if (!findings.has(id)) findings.set(id, { kind: "conflict", ruleId, severity, message, file, line });
  };
  const by = (file: string) => {
    const who = ctx.theirsCommit(file);
    return who ? ` (${who})` : "";
  };
  const L = ctx.theirsLabel;

  for (const o of oursChanges) {
    const t = theirsByKey.get(`${o.file}\0${o.name}`);
    if (!t) continue;
    const textual = ctx.textConflicts.has(o.file);

    // R1: the same function edited on both sides.
    if (isEdit(o) && isEdit(t) && (o.symbol.body !== t.symbol.body || o.symbol.params !== t.symbol.params)) {
      add(
        "conflict-same-function",
        textual ? "medium" : "high",
        o.file,
        o.symbol.startLine,
        o.name,
        textual
          ? `${display(o.symbol)} was also edited on ${L}${by(o.file)}; Git will report a text conflict here, so merge both changes carefully`
          : `${display(o.symbol)} was also edited on ${L}${by(o.file)}. The edits don't overlap, so Git will merge them silently; check that the combined logic still works`,
      );
    }
    // R3: removed on one side, edited on the other.
    if (isRemoval(o) && isEdit(t)) {
      add("conflict-removed-vs-edited", "high", o.file, o.symbol.startLine, o.name,
        `You ${apiChange(o)}, but it was edited on ${L}${by(o.file)}; those edits will be lost or orphaned`);
    }
    if (isEdit(o) && isRemoval(t)) {
      add("conflict-removed-vs-edited", "high", o.file, o.symbol.startLine, o.name,
        `${L} ${apiChange(t)}${by(o.file)}, but your branch edits it`);
    }
    // R4: both sides added a definition with the same name.
    if (o.kind === "added" && t.kind === "added" && (o.symbol.body !== t.symbol.body || o.symbol.params !== t.symbol.params)) {
      add("conflict-duplicate-definition", "medium", o.file, o.symbol.startLine, o.name,
        `Both your branch and ${L}${by(o.file)} add a different ${display(o.symbol)}; only one definition can survive the merge`);
    }
  }

  // R2: API changed on one side while the other side adds calls to it.
  for (const t of theirsChanges.filter((c) => c.kind === "signature" || isRemoval(c))) {
    for (const call of callersOf(t, oursCalls)) {
      add("conflict-changed-api", "high", call.file, call.line, t.name,
        `${L} ${apiChange(t)} in ${t.file}${by(t.file)}, but your branch adds new calls to it`);
    }
  }
  for (const o of oursChanges.filter((c) => c.kind === "signature" || isRemoval(c))) {
    const callers = callersOf(o, theirsCalls);
    if (callers.length > 0) {
      const where = [...new Set(callers.map((c) => `${c.file}:${c.line}`))].slice(0, 3).join(", ");
      add("conflict-changed-api", "high", o.file, o.symbol.startLine, o.name,
        `You ${apiChange(o)}, but ${L} adds new calls to it (${where})`);
    }
  }

  // Plain text conflicts Git will report, for files without a more specific finding.
  const withFindings = new Set([...findings.values()].map((f) => f.file));
  for (const file of [...ctx.textConflicts].sort()) {
    if (!withFindings.has(file)) {
      add("conflict-text", "medium", file, 0, file,
        `Git will report a merge conflict in this file when merging with ${L}${by(file)}`);
    }
  }

  const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...findings.values()]
    .map((f) => (f.line ? f : { ...f, line: undefined }))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}
