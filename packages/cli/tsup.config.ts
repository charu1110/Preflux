import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  // Bundle the workspace types package so the published CLI has no workspace deps.
  noExternal: ["@preflux/shared"],
  banner: { js: "#!/usr/bin/env node" },
});
