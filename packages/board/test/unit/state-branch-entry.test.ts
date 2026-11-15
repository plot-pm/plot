import { describe, expect, it } from 'vitest';
import type { Host } from '@plot-pm/domain';

import { run } from '../../src/server/entry/state-branch.js';

/** A host whose `branchRestrictions` answers as given and records the branch asked. */
const hostAnswering = (answer: unknown, asked: string[] = []): Host =>
  ({
    branchRestrictions: async (branch: string) => {
      asked.push(branch);
      return answer;
    },
    lastRefusal: () => null,
  }) as unknown as Host;

const printed = async (argv: string[], host: Host): Promise<{ code: number; json: unknown }> => {
  let out = '';
  const code = await run(argv, host, (s) => {
    out += s;
  });
  return { code, json: out === '' ? null : JSON.parse(out) };
};

describe('plot-state-branch.mjs', () => {
  it('proposes plot/state for a restricted default branch', async () => {
    const asked: string[] = [];
    const { code, json } = await printed(['--default', 'main'], hostAnswering({ ok: true, value: ['protected'] }, asked));
    expect(code).toBe(0);
    expect(asked).toEqual(['main']);
    expect(json).toMatchObject({ state: 'restricted', proposed: 'plot/state' });
  });

  it('prints unverified, exit 0, for a refused and for an unaskable host', async () => {
    for (const why of ['failed', 'unaskable']) {
      const { code, json } = await printed(['--default', 'main'], hostAnswering({ ok: false, why }));
      expect(code).toBe(0);
      expect(json).toEqual({ state: 'unverified' });
    }
  });

  it('prints unrestricted for an answered empty list', async () => {
    const { json } = await printed(['--default', 'main'], hostAnswering({ ok: true, value: [] }));
    expect(json).toEqual({ state: 'unrestricted' });
  });

  it('does not ask the host when the key is set', async () => {
    const asked: string[] = [];
    const { json } = await printed(['--default', 'main', '--key', 'plot/state'], hostAnswering({ ok: true, value: ['protected'] }, asked));
    expect(asked).toEqual([]);
    expect(json).toMatchObject({ state: 'declared', isBranch: true });
  });

  it('exits 2 without --default', async () => {
    expect((await printed([], hostAnswering({ ok: true, value: [] }))).code).toBe(2);
  });
});
