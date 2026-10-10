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

describe('the default-branch reading has one writer', () => {
  it('names the store write only in the domain and in fleetd\'s refresh file', () => {
    const writers = fs.readdirSync(packages)
      .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
      .flatMap((name) => sources(path.join(packages, name, 'src')))
      .filter((file) => /defaultBranchFile|DefaultBranchStore/.test(fs.readFileSync(file, 'utf8')))
      .filter((file) => /\.write\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(packages, file).split(path.sep).join('/'));
    expect(writers.filter((file) => !file.startsWith('domain/'))).toEqual([
      'fleet/src/shared/default-branch-refresh.ts',
    ]);
  });
});
