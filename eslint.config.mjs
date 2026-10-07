import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".local/**",
    "lib/db/schema.ts",
    "playwright-report/**",
    "test-results/**",
    "public/vendor/**",
    ".shots/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Secrets and configuration are read in exactly one place (lib/env.ts),
      // so nothing else can leak a server variable into a client bundle.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read configuration through lib/env.ts (server) or lib/public-env.ts (browser).",
        },
      ],
    },
  },
  {
    // The hand-written service worker runs in a worker, not a page.
    files: ["public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["lib/env.ts", "lib/public-env.ts", "lib/auth-mode.ts", "next.config.ts", "playwright.config.ts", "vitest.config.ts", "scripts/**", "tests/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // ENG-08: the service-role connection bypasses RLS. Only jobs, webhooks and
    // the local-auth bootstrap may touch it; request handlers go through withRls.
    files: ["app/**", "components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/db/service", message: "Service-role access bypasses RLS. Use withRls from @/lib/db/rls in request code." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
