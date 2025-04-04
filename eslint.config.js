import js from '@eslint/js';
import globals from 'globals';

export default {
  extends: [js.configs.recommended],
  files: ['**/*.{js,jsx}'],
  languageOptions: {
    ecmaVersion: 2020,
    globals: {
      ...globals.browser,
      h: 'readonly', // For Preact's JSX
    },
  },
  rules: {
    // Simplified rules without React-specific plugins
  },
};
