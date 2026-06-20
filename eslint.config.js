import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', '.wrangler/**', 'worker-configuration.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // 👇 この推奨設定の中に「any禁止(@typescript-eslint/no-explicit-any)」が含まれています
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ---------------------------------------------------
      // 💡 最低限の開発効率を担保するための調整
      // ---------------------------------------------------

      // 開発途中の「とりあえず定義しただけの変数」でエラーにならないよう「警告(warn)」に緩和
      '@typescript-eslint/no-unused-vars': 'warn',

      // useEffectの依存配列(deps)の指摘も「警告(warn)」に緩和
      'react-hooks/exhaustive-deps': 'warn',

      // AppShellなどで Context などを export した時に怒られるViteの厳格ルールをオフ
      'react-refresh/only-export-components': 'off',

      // 画面描画のパフォーマンスに関する過剰なおせっかいルールをオフ
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/incompatible-library': 'off',

      // try-catchのcauseエラーをオフ（使っている場合）
      'preserve-caught-error': 'off',
    },
  },
]);
