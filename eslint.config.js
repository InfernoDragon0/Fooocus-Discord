import tseslint from 'typescript-eslint';

const orbitPlugin = {
  rules: {
    'no-comments': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ loc: comment.loc, message: 'Comments belong in claude-orbit.md' });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { orbit: orbitPlugin },
    rules: {
      'orbit/no-comments': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
);
