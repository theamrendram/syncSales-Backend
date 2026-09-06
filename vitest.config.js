import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",

    // The suite was written for Jest and calls describe/it/expect without
    // importing them. `globals: true` keeps those files unedited.
    globals: true,

    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js"],

    // tests/setup.js installs shared module mocks (prisma, clerk, axios).
    // A single fork keeps that setup applied consistently and avoids each
    // worker racing to build its own copy of the mocked module graph.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },

    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.js"],
      exclude: ["src/app.js", "**/node_modules/**"],
    },
  },
});
