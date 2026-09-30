import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // e2e tests create real git repos and run pushes.
    testTimeout: 60_000,
  },
});
