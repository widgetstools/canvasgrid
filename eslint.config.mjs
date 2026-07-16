// @ts-check
// Cycle 19 / Task 8c — workspace-wide ESLint flat config.
//
// The sole purpose of this config is the `no-restricted-syntax` rule
// under the second block: cgrid uses a strict two-identifier vocabulary
// for row + column identity throughout its API surface:
//
//   • row identity is ALWAYS spelled `rowId`
//   • column identity is ALWAYS spelled `colId`
//
// The rule forbids the three permutations that would silently diverge
// (`columnId`, `rowKey`, `columnKey`) — surfaced immediately at lint
// time rather than as a slow rot in review. Preventive (zero identifier
// violations exist on `main` as of the introduction commit) but does
// the load-bearing job of freezing the vocabulary going forward.
//
// The rule uses the ESLint core `no-restricted-syntax` selector engine
// (no custom plugin required) so authors can extend the forbidden set
// in-place without a re-publish cycle. Each entry names an exact
// identifier — the intent is to catch declarations AND usages so a
// rename left behind stays flagged. Object property shorthand
// (`{ columnId }`) is still an `Identifier` node so it fires there too.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'ag-grid-react-master/**',
      'grouping-behaviors-prompts/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts', 'apps/*/src/**/*.ts', 'apps/*/e2e/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
      },
    },
    // Register the typescript-eslint plugin so its rule names (e.g.
    // `@typescript-eslint/no-explicit-any`) resolve when the codebase
    // has legacy `eslint-disable-next-line @typescript-eslint/…`
    // directives. We DO NOT enable any of its rules here — cgrid uses
    // `any` deliberately at many boundaries (worker postMessage, the
    // permissive-default generic surface). This registration just
    // silences "Definition for rule '…' was not found" errors on the
    // pre-existing disable comments.
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    linterOptions: {
      // The pre-existing `eslint-disable` directives target rules that
      // weren't running before (there was no ESLint at all). Reporting
      // every one as an unused directive would create a churn PR out of
      // scope for this task. Off.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Core hygiene (kept light — type-aware floating-promise rules stay
      // deferred until the workspace can afford project-service lint cost).
      'no-debugger': 'error',
      'no-var': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='columnId']",
          message: "Use 'colId' — cgrid uses colId for column identity, never columnId.",
        },
        {
          selector: "Identifier[name='rowKey']",
          message: "Use 'rowId' — cgrid uses rowId for row identity, never rowKey.",
        },
        {
          selector: "Identifier[name='columnKey']",
          message: "Use 'colId' — cgrid uses colId for column identity, never columnKey.",
        },
      ],
    },
  },
);
