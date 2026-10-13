import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only يرمي خطأ خارج بيئة React Server؛ في الاختبارات نستبدله بوحدة فارغة.
      "server-only": path.resolve(__dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/env.ts"],
    // الاختبارات تتشارك قاعدة بيانات واحدة، لذا تعمل ملفاتها بالتتابع.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
