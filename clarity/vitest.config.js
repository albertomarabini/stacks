// vitest.config.ts
import { defineConfig } from "vitest/config.js";
import { vitestSetupFilePath } from "@hirosystems/clarinet-sdk/vitest";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [vitestSetupFilePath],
    // optional: point to a non-standard manifest path
    // env: { CLARINET_MANIFEST_PATH: "./Clarinet.toml" },
  },
});
