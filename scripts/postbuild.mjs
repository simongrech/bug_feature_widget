/**
 * Two things the bundler will not do reliably.
 *
 * 1. `use client`. tsup applies it as an esbuild banner, but the tree-shaking
 *    pass that runs afterwards strips module-level directives back out — with
 *    a warning that reads like it is about the input, not the output. Without
 *    the directive every consumer has to wrap the widget in a client component
 *    of their own, so it is re-applied here and then asserted.
 * 2. The stylesheet, which needs no compilation, only to land in dist/ so that
 *    `@melatech/feedback-widget/styles.css` resolves.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTIVE = '"use client";\n';

for (const file of ['dist/index.js', 'dist/index.cjs']) {
  const path = join(root, file);
  const source = readFileSync(path, 'utf8');
  if (!source.startsWith(DIRECTIVE)) {
    writeFileSync(path, DIRECTIVE + source);
  }
}

mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(join(root, 'src/styles.css'), join(root, 'dist/styles.css'));

// Assert rather than trust: a silently missing directive only shows up as a
// confusing "useState is not a function" in somebody else's app.
for (const file of ['dist/index.js', 'dist/index.cjs']) {
  if (!readFileSync(join(root, file), 'utf8').startsWith(DIRECTIVE)) {
    throw new Error(`${file} is missing the "use client" directive`);
  }
}
if (readFileSync(join(root, 'dist/server/index.js'), 'utf8').includes('use client')) {
  throw new Error('dist/server/index.js must not be a client module');
}

console.log('postbuild: "use client" applied, styles.css copied');
