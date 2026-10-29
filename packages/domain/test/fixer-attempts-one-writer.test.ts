import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [full] : [];
  });

const allSources = (): { file: string; text: string }[] =>
  fs
    .readdirSync(packages)
    .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
    .flatMap((name) => sources(path.join(packages, name, 'src')))
    .map((file) => ({
      file: path.relative(packages, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf8'),
    }));

describe('the fixer attempts record has one writing place', () => {
  it('serialises through encodeFixerAttempts only in the file adapter', () => {
    const callers = allSources()
      .flatMap(({ file, text }) => (text.match(/\bencodeFixerAttempts\s*\(/g) ?? []).map(() => file));
    expect(callers).toEqual(['domain/src/adapters/fixer-attempts/fixer-attempts-file.ts']);
  });

  it('defines fixerAttemptsFile — the only factory touching the file — in one place', () => {
    const definitions = allSources()
      .flatMap(({ file, text }) => (text.match(/\bexport const fixerAttemptsFile\s*=/g) ?? []).map(() => file));
    expect(definitions).toEqual(['domain/src/adapters/fixer-attempts/fixer-attempts-file.ts']);
  });
});
