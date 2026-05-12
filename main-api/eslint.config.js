const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'demo/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_|^next$',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_|^err$|^error$',
        },
      ],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
    },
  },
];
