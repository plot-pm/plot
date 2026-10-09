import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [full] : [];
  });

describe('the PR index has one writer', () => {
  it('names foldPrIndex only in the domain and the fleet package', () => {
    const importers = fs.readdirSync(packages)
      .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
      .flatMap((name) => sources(path.join(packages, name, 'src')))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('foldPrIndex'))
      .map((file) => path.relative(packages, file).split(path.sep)[0]);
    expect(new Set(importers)).toEqual(new Set(['domain', 'fleet']));
  });
});
