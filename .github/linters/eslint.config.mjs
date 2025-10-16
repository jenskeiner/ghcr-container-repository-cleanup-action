import jest from 'eslint-plugin-jest'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import github from 'eslint-plugin-github'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import prettier from 'eslint-plugin-prettier'
import prettierConfig from 'eslint-config-prettier'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Project root is two directories up from this config file
const projectRoot = path.resolve(__dirname, '../..')

const compat = new FlatCompat({
  baseDirectory: projectRoot,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

export default [
  // Global ignores - MUST come first to exclude files from all rules
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/citester/**',
      '**/coverage/**',
      '**/*.json',
      '.github/linters/**'
    ]
  },

  // JavaScript base configuration
  js.configs.recommended,

  // GitHub plugin configurations
  github.getFlatConfigs().recommended,
  ...github.getFlatConfigs().typescript,

  // TypeScript configuration - only for .ts files
  ...compat.extends(
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jest/recommended'
  ),

  {
    files: ['**/*.ts'],

    plugins: {
      jest,
      '@typescript-eslint': typescriptEslint,
      prettier
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      },

      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',

      parserOptions: {
        project: [
          path.resolve(projectRoot, '.github/linters/tsconfig.json'),
          path.resolve(projectRoot, 'tsconfig.json')
        ]
      }
    },

    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: path.resolve(projectRoot, '.github/linters/tsconfig.json')
        }
      }
    },

    rules: {
      'import/named': 0,
      camelcase: 'off',
      'eslint-comments/no-use': 'off',
      'eslint-comments/no-unused-disable': 'off',
      'i18n-text/no-en': 'off',
      'import/no-namespace': 'off',
      'no-console': 'off',
      'no-unused-vars': 'off',
      'prettier/prettier': 'error',
      semi: 'off',
      '@typescript-eslint/array-type': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-assertions': 'error',

      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'no-public'
        }
      ],

      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true
        }
      ],

      '@typescript-eslint/func-call-spacing': ['error', 'never'],
      '@typescript-eslint/no-array-constructor': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],

      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-for-of': 'warn',
      '@typescript-eslint/prefer-function-type': 'warn',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/semi': ['error', 'never'],
      '@typescript-eslint/space-before-function-paren': 'off',
      '@typescript-eslint/type-annotation-spacing': 'error',
      '@typescript-eslint/unbound-method': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': ['error']
    }
  },

  // Prettier config - disable conflicting rules
  prettierConfig
]
