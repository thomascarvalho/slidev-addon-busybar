import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: true,
    /* Slides and the README are prose, not code to lint. */
    markdown: false,
    ignores: ['dist', 'example/node_modules', 'docs', '**/*.md'],
  },
  {
    rules: {
      /* Tests run on Node's own runner, on purpose: no test dependency. */
      'test/no-import-node-test': 'off',
      /* Doc comments start on the first line, the way the codebase reads. */
      'jsdoc/multiline-blocks': 'off',
    },
  },
  {
    /* Slidev loads the addon's built plugin. */
    files: ['vite.config.ts'],
    rules: { 'antfu/no-import-dist': 'off' },
  },
  {
    /* A script for the hardware: prints, awaits at top level. */
    files: ['src/preview.ts'],
    rules: { 'no-console': 'off', 'antfu/no-top-level-await': 'off' },
  },
  {
    /* `Button` and `SwitchPosition` are a value and a type of the same name,
       the pattern Node's type stripping allows instead of enums. */
    files: ['src/input.ts'],
    rules: { 'ts/no-redeclare': 'off' },
  },
)
