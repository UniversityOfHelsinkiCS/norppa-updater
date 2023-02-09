module.exports = {
  extends: ['prettier'],
  plugins: ['prettier'],
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
  },
  env: {
    node: true,
  },
  rules: {
    'prettier/prettier': ['warn'],
    'max-len': [1, 400],
    'no-shadow': 0,
    'no-plusplus': 0,
    'import/no-unresolved': 'off',
    'no-unused-vars': 'warn',
    'no-param-reassign': 'off',
    'no-restricted-exports': 'off',
    'import/prefer-default-export': 'off',
    'no-restricted-syntax': 'off',
    'no-await-in-loop': 'off',
    'spaced-comment': 'off',
  },
}
