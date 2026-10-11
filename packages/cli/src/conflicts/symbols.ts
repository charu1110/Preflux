import { withSyntaxTree, type LanguageId, type SyntaxNode } from "./parser.js";

// Turns a source file into the units conflicts are reasoned about: named functions, methods
// and classes (with their parameters and body text), plus the functions it calls.

export type SymbolKind = "function" | "method" | "class";

export interface CodeSymbol {
  /** Qualified name: "total", "Cart.total", "app.handle". */
  name: string;
  kind: SymbolKind;
  /** 1-indexed lines. */
  startLine: number;
  endLine: number;
  /** Parameter list, whitespace-normalised ("" for classes). */
  params: string;
  /** Body text, whitespace-normalised: equal bodies mean "no real change". */
  body: string;
}

export interface CallSite {
  text: string;
  line: number;
}

export interface FileStructure {
  symbols: Map<string, CodeSymbol>;
  /** Callee simple name -> every call site (normalised call text + 1-indexed line). */
  calls: Map<string, CallSite[]>;
}

const normalise = (text: string) => text.replace(/\s+/g, " ").trim();
const line = (n: SyntaxNode) => n.startPosition.row + 1;

function addSymbol(out: Map<string, CodeSymbol>, name: string, kind: SymbolKind, node: SyntaxNode, params: SyntaxNode | null, body: SyntaxNode | null) {
  // A later definition with the same name overrides the earlier one, as at runtime.
  out.set(name, {
    name,
    kind,
    startLine: line(node),
    endLine: node.endPosition.row + 1,
    params: params ? normalise(params.text) : "",
    body: normalise((body ?? node).text),
  });
}

/** A class (declaration or expression) and its methods, qualified as "Class.method". */
function addClass(out: Map<string, CodeSymbol>, name: string, classNode: SyntaxNode, anchor: SyntaxNode) {
  const body = classNode.childForFieldName("body");
  addSymbol(out, name, "class", anchor, null, body);
  for (const member of body?.namedChildren ?? []) {
    if (member?.type !== "method_definition") continue;
    const method = member.childForFieldName("name")?.text;
    if (method) addSymbol(out, `${name}.${method}`, "method", member, member.childForFieldName("parameters"), member.childForFieldName("body"));
  }
}

const JS_FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "generator_function"]);

function jsSymbols(root: SyntaxNode, out: Map<string, CodeSymbol>) {
  const visit = (node: SyntaxNode, scope: string | null) => {
    for (const child of node.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "export_statement":
        case "expression_statement":
          visit(child, scope);
          break;
        case "function_declaration":
        case "generator_function_declaration": {
          const name = child.childForFieldName("name")?.text;
          if (name) addSymbol(out, scope ? `${scope}.${name}` : name, "function", child, child.childForFieldName("parameters"), child.childForFieldName("body"));
          break;
        }
        case "class_declaration":
        case "abstract_class_declaration": {
          const name = child.childForFieldName("name")?.text;
          if (name) addClass(out, name, child, child);
          break;
        }
        case "lexical_declaration":
        case "variable_declaration":
          // const total = (a, b) => ... / var handle = function () {}
          for (const decl of child.namedChildren) {
            if (decl?.type !== "variable_declarator") continue;
            const name = decl.childForFieldName("name");
            const value = decl.childForFieldName("value");
            if (name?.type === "identifier" && value && JS_FUNCTION_VALUES.has(value.type)) {
              addSymbol(out, name.text, "function", decl, value.childForFieldName("parameters") ?? value.childForFieldName("parameter"), value.childForFieldName("body"));
            } else if (name?.type === "identifier" && value?.type === "class") {
              // const Repo = class { ... }
              addClass(out, value.childForFieldName("name")?.text ?? name.text, value, decl);
            }
          }
          break;
        case "assignment_expression": {
          // CommonJS style: app.handle = function (req, res) {} / exports.total = (a) => ...
          const left = child.childForFieldName("left");
          const right = child.childForFieldName("right");
          if (left && right && JS_FUNCTION_VALUES.has(right.type) && (left.type === "member_expression" || left.type === "identifier")) {
            addSymbol(out, normalise(left.text), "function", child, right.childForFieldName("parameters") ?? right.childForFieldName("parameter"), right.childForFieldName("body"));
          } else if (left && right?.type === "class") {
            // module.exports = class Application extends Emitter { ... }
            addClass(out, right.childForFieldName("name")?.text ?? normalise(left.text), right, child);
          }
          break;
        }
      }
    }
  };
  visit(root, null);
}

function pySymbols(root: SyntaxNode, out: Map<string, CodeSymbol>) {
  const visit = (node: SyntaxNode, className: string | null) => {
    for (const raw of node.namedChildren) {
      if (!raw) continue;
      const child = raw.type === "decorated_definition" ? raw.childForFieldName("definition") : raw;
      if (!child) continue;
      const name = child.childForFieldName("name")?.text;
      if (!name) continue;
      const anchor = raw; // include decorators in the line range
      if (child.type === "function_definition") {
        addSymbol(out, className ? `${className}.${name}` : name, className ? "method" : "function", anchor, child.childForFieldName("parameters"), child.childForFieldName("body"));
      } else if (child.type === "class_definition" && !className) {
        addSymbol(out, name, "class", anchor, null, child.childForFieldName("body"));
        const body = child.childForFieldName("body");
        if (body) visit(body, name);
      }
    }
  };
  visit(root, null);
}

function collectCalls(root: SyntaxNode, language: LanguageId): FileStructure["calls"] {
  const calls: FileStructure["calls"] = new Map();
  const types = language === "python" ? ["call"] : ["call_expression", "new_expression"];
  for (const call of root.descendantsOfType(types)) {
    if (!call) continue;
    const callee = call.childForFieldName(call.type === "new_expression" ? "constructor" : "function");
    if (!callee) continue;
    // foo(), obj.foo(), self.foo() -> "foo"
    const nameNode =
      callee.type === "identifier"
        ? callee
        : callee.type === "member_expression"
          ? callee.childForFieldName("property")
          : callee.type === "attribute"
            ? callee.childForFieldName("attribute")
            : null;
    const name = nameNode?.text;
    if (!name) continue;
    const sites = calls.get(name) ?? [];
    sites.push({ text: normalise(call.text), line: line(call) });
    calls.set(name, sites);
  }
  return calls;
}

const EMPTY: FileStructure = { symbols: new Map(), calls: new Map() };

/** Structure of a source file; an empty structure for missing files or unsupported languages. */
export async function fileStructure(path: string, source: string | null): Promise<FileStructure> {
  if (source === null) return EMPTY;
  const result = await withSyntaxTree(path, source, (root, language) => {
    const symbols = new Map<string, CodeSymbol>();
    if (language === "python") pySymbols(root, symbols);
    else jsSymbols(root, symbols);
    return { symbols, calls: collectCalls(root, language) };
  });
  return result ?? EMPTY;
}

/** "Cart.total" -> "total", "app.handle" -> "handle": the name a call site would use. */
export function simpleName(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf(".") + 1);
}
