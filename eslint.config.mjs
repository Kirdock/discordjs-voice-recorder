import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig([
  globalIgnores(['dist/', 'node_modules/', 'coverage/']),

  js.configs.recommended,
  // includes parser, plugin, and the "eslint-recommended" overrides
  tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  },

  // Prettier turns off conflicting formatting rules, so it goes last
  // before your own overrides of those rules
  eslintConfigPrettier,

  {
    rules: {
      quotes: ['error', 'single'],
      indent: ['error', 4],
    },
  },
]);