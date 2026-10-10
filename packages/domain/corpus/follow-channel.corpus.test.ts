import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The turn-gate rule exists twice: in the domain, where it is tested, and in
 * `mods/plot-follow/hooks/`, where the mod runs it. A mod installs as its own
 * folder and cannot import the workspace, so the copy is declared, and this
 * test fails when the two differ.
 */
describe('the mod copy of the follow-channel rule', () => {
  it('is byte-identical to the domain rule', () => {
    const domain = 'packages/domain/src/rules/follow-channel.ts';
    const mod = 'mods/plot-follow/hooks/follow-channel.ts';
    const read = (path: string) => readFileSync(resolve(__dirname, '../../..', path), 'utf8');

    expect(
      read(mod) === read(domain),
      `the-mod-copy-says :: follow-channel :: ${mod} differs from ${domain}; copy the domain file over the mod's`,
    ).toBe(true);
  });
});
