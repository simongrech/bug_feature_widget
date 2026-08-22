import { defineConfig } from 'tsup';

/**
 * Two builds, because only the UI entry may carry the `use client` directive.
 * `./server` is imported from route handlers and must stay a server module —
 * tagging it would make Next try to ship it to the browser, API key and all.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    // No `treeshake`: that pass strips the `use client` directive back out.
    // scripts/postbuild.mjs applies it after the build and asserts it stuck.
  },
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
  },
]);
