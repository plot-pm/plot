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

const productionFiles = (): string[] =>
  fs.readdirSync(packages)
    .filter((name) => fs.existsSync(path.join(packages, name, 'src')))
    .flatMap((name) => sources(path.join(packages, name, 'src')));

const relative = (file: string): string => path.relative(packages, file).split(path.sep).join('/');

describe('the channel has one starter', () => {
  it('names `startChannel` as a value only in the transport, its export, and fleetd\'s entry point', () => {
    const named = productionFiles()
      .filter((file) => /\bstartChannel\b/.test(
        fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n'),
      ))
      .map(relative);
    expect(named.sort()).toEqual([
      'domain/src/adapters/channel/channel-socket.ts',
      'domain/src/adapters/index.ts',
      'fleet/src/server/entry/registryd-main.ts',
    ]);
  });
});

describe('the IndexMonitor reads files, never the host', () => {
  it('imports no host port, host adapter or host script', () => {
    const source = fs.readFileSync(path.join(packages, 'fleet/src/shared/index-monitor.ts'), 'utf8');
    const imports = source.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/ports\/host|host-shell|adapters\/host|plot-host/);
    expect(imports).not.toMatch(/child_process|node:child_process/);
    const rule = fs.readFileSync(path.join(packages, 'domain/src/rules/index-findings.ts'), 'utf8');
    expect(rule.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')).not.toMatch(/ports\/|adapters\//);
  });
});
