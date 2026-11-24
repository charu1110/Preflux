import { defineConfig } from "tsup";

export default defineConfig({
  // merge-study is a research script (docs/merge-study.md), not part of the CLI commands.
  entry: { index: "src/index.ts", "merge-study": "scripts/merge-study.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Bundle the workspace types package so the published CLI has no workspace deps.
  noExternal: ["@preflux/shared"],
  banner: { js: "#!/usr/bin/env node" },
});
