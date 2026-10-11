import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type * as TreeSitter from "@vscode/tree-sitter-wasm";

// Tree-sitter via Microsoft's prebuilt WebAssembly grammars (@vscode/tree-sitter-wasm):
// no native compilation, so `npm install` works on every OS without build tools.

export type LanguageId = "javascript" | "typescript" | "tsx" | "python";
export type SyntaxNode = TreeSitter.Node;

const require = createRequire(import.meta.url);

const EXTENSION_LANGUAGE: Record<string, LanguageId> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

export function languageFor(path: string): LanguageId | null {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : (EXTENSION_LANGUAGE[path.slice(dot).toLowerCase()] ?? null);
}

interface Loaded {
  parser: TreeSitter.Parser;
  languages: Map<LanguageId, TreeSitter.Language>;
}

let loading: Promise<Loaded> | null = null;

/** Initialise the WASM runtime and grammars once per process (~30 ms). */
function load(): Promise<Loaded> {
  loading ??= (async () => {
    const ts = require("@vscode/tree-sitter-wasm") as typeof TreeSitter;
    const wasmDir = join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
    await ts.Parser.init({ locateFile: (file: string) => join(wasmDir, file) });
    const languages = new Map<LanguageId, TreeSitter.Language>();
    for (const id of ["javascript", "typescript", "tsx", "python"] as const) {
      languages.set(id, await ts.Language.load(join(wasmDir, `tree-sitter-${id}.wasm`)));
    }
    return { parser: new ts.Parser(), languages };
  })();
  return loading;
}

/**
 * Parse source and hand the syntax tree to `fn`. The tree lives in WASM memory and is freed
 * afterwards, so `fn` must copy out what it needs. Null if the language is unsupported.
 */
export async function withSyntaxTree<T>(
  path: string,
  source: string,
  fn: (root: SyntaxNode, language: LanguageId) => T,
): Promise<T | null> {
  const language = languageFor(path);
  if (!language) return null;
  const { parser, languages } = await load();
  parser.setLanguage(languages.get(language)!);
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    return fn(tree.rootNode, language);
  } finally {
    tree.delete();
  }
}
