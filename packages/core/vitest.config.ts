import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ryanos/ai": new URL("../ai/src/index.ts", import.meta.url).pathname,
      "@ryanos/shared": new URL("../shared/src/index.ts", import.meta.url).pathname
    }
  }
});

