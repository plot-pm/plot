import { describe, expect, it } from 'vitest';
import type { Host } from '@plot-pm/domain';

import { run } from '../../src/server/entry/pr-state.js';

/** A host whose `prState` answers as given and records what it was asked. */
const hostAnswering = (answer: unknown, asked: unknown[] = []): Host =>
  ({
    prState: async (ref: unknown, opts: unknown) => {
      asked.push([ref, opts]);
      return answer;
    },
    lastRefusal: () => null,
  }) as unknown as Host;

describe('plot-pr-state.mjs', () => {
  it('asks with the repo a cross-repo reference names, and prints the PR', async () => {
    const asked: unknown[] = [];
    let out = '';
    const code = await run(['4711', 'quatico/other'], hostAnswering({ ok: true, value: { number: 4711, state: 'MERGED' } }, asked), (s) => {
      out += s;
    });
    expect(code).toBe(0);
    expect(asked).toEqual([[4711, { repo: 'quatico/other' }]]);
    expect(JSON.parse(out)).toEqual({ number: 4711, state: 'MERGED' });
  });

  it('asks with no repo where none is named, and prints NONE for a miss', async () => {
    const asked: unknown[] = [];
    let out = '';
    const code = await run(['12', ''], hostAnswering({ ok: true, value: null }, asked), (s) => {
      out += s;
    });
    expect(code).toBe(0);
    expect(asked).toEqual([[12, {}]]);
    expect(JSON.parse(out)).toEqual({ state: 'NONE' });
  });

  it('exits 3 where the host could not be asked, and 4 where it has no answer', async () => {
    expect(await run(['12'], hostAnswering({ ok: false, why: 'failed' }), () => {})).toBe(3);
    expect(await run(['12'], hostAnswering({ ok: false, why: 'unaskable' }), () => {})).toBe(4);
  });

  it('exits 2 on an argument that is not a PR number', async () => {
    expect(await run(['abc'], hostAnswering({ ok: true, value: null }), () => {})).toBe(2);
  });
});
