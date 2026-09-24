import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/isolateGlobalState.ts"],
    // Room for the registry-persistence waits above the default 5s.
    testTimeout: 20_000,
  },
});
