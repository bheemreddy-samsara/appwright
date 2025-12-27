import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "extension-src/**",
      "example/**",
      "eslint.config.js",
    ],
  },
  js.configs.recommended,
  ...compat.extends("@empiricalrun/eslint-config/playwright"),
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "autofix/no-unused-vars": "off",
    },
  },
];
