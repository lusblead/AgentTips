import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "playwright-report",
      "test-results",
      "src-tauri/target",
      "src-tauri/gen",
      "src/schemas/hotkey-keys.generated.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/api"],
              message:
                "@tauri-apps/api 只允许在 src/desktop-api 适配层使用；feature 组件必须通过 DesktopApi facade 调用。",
            },
          ],
        },
      ],
    },
  },
);
