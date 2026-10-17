// One config for the three workspaces. Real-bug rules are errors and block CI; style-ish rules are warnings
// (they are reported, never block) until they have been worked down. See docs in CONTRIBUTING.md.
const path = require("path");

module.exports = {
  root: true,
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    "coverage/",
    "app/android/",
    "app/ios/",
    "**/*.bundle",
    "safelink-dashboard/dist/",
  ],
  overrides: [
    {
      // Phone app: React Native's own rules (hooks, JSX, no-undef...) plus jest globals in tests
      files: ["app/**/*.{js,jsx}"],
      extends: "@react-native",
      env: { jest: true, node: true },
      // the parser looks for the Babel config next to the working directory; the app's lives in app/
      parserOptions: { babelOptions: { cwd: path.join(__dirname, "app"), configFile: path.join(__dirname, "app", "babel.config.js") } },
      rules: {
        // formatting is Prettier's job and is checked separately (changed files only)
        "prettier/prettier": "off",
        quotes: "off",
        curly: "off",
        "comma-dangle": "off",
        "no-trailing-spaces": "off",
        // the binary protocol, hashing and codec code uses bitwise operators on purpose
        "no-bitwise": "off",
        "react-native/no-inline-styles": "off",
        "react/no-unstable-nested-components": "warn",
        "no-shadow": "warn",
        "no-unused-vars": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "no-void": "warn",
        "eqeqeq": "warn",
      },
    },
    {
      // API server: CommonJS on Node
      files: ["server/**/*.js"],
      extends: "eslint:recommended",
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: "latest", sourceType: "script" },
      rules: { "no-unused-vars": ["warn", { args: "none" }], "no-empty": ["warn", { allowEmptyCatch: true }] },
    },
    {
      // Dashboard: browser ES modules with JSX
      files: ["safelink-dashboard/src/**/*.{js,jsx}", "safelink-dashboard/vite.config.js"],
      extends: ["eslint:recommended", "plugin:react-hooks/recommended"],
      env: { browser: true, es2022: true },
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      rules: { "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }], "react-hooks/exhaustive-deps": "warn" },
    },
    {
      // Repo scripts (ESM) and the dev helper
      files: ["scripts/**/*.js"],
      extends: "eslint:recommended",
      env: { node: true, es2022: true },
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
  ],
};
