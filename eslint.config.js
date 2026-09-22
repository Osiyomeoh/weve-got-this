import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config. Lints the TypeScript sources under src/; formatting is owned by
// Prettier, so eslint-config-prettier turns off every rule that would fight it.
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'firetv/**', 'packages/**', 'sim-ui/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Underscore-prefixed args/vars are an intentional "unused on purpose" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests and CLI scripts speak to consoles and use looser shapes on purpose.
    files: ['src/**/*.test.ts', 'src/demo/**/*.ts', 'src/sim/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
