import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('package entries', () => {
  it('marks the browser entry as a client module', () => {
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).toMatch(/^['"]use client['"]/);
  });

  it('keeps the server entry free of React and of a client directive', () => {
    const source = readFileSync(join(root, 'src/server/index.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]react(?:-dom)?['"]/);
    // The file may mention the directive in a comment; it must not *be* one.
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});
