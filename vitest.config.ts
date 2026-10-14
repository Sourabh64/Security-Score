import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: "file:./test.db", EVIDENCE_UPLOAD_DIR: "data/test-uploads" },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
