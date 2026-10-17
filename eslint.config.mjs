import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Client Prisma généré
      'apps/api/src/generated/**',
      // Composants générés par shadcn/ui
      'apps/*/src/components/ui/**',
      'packages/ui/src/components/ui/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: [
      'apps/backoffice/**/*.{ts,tsx}',
      'apps/storefront/**/*.{ts,tsx}',
      'packages/ui/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Toute action annonce son résultat via `notify` : jamais `toast()` ni `sonner` en direct.
    files: ['apps/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/feedback/notify.ts', 'packages/ui/src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              message: 'Utiliser `notify` de @resto/ui (jamais toast() directement).',
            },
          ],
        },
      ],
    },
  },
);
