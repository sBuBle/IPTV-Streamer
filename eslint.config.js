import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      // `h` is the Preact JSX factory and is used implicitly
      'no-unused-vars': ['warn', { varsIgnorePattern: '^h$', args: 'none', caughtErrors: 'none' }],
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
    },
  },
];
