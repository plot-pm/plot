import { describe, expect, it } from 'vitest';

import { answered, failed, type PortResult } from '../src/index.js';
import { unpushedAfterMerge, type UnpushedAfterMergePorts } from '../src/workflows/unpushed-after-merge.js';

type Lines = PortResult<readonly string[]>;

/** Ports that answer from the given readings and record each git and host call. */
const ports = (over: {
  plain?: Lines;
  excluding?: Lines;
  patches?: Lines;
  heads?: Lines;
  held?: readonly string[];
}) => {
  const calls: string[] = [];
  const value: UnpushedAfterMergePorts = {
    trees: {
      unpushedCommits: async (_path, exclude) => {
        calls.push(`commits ${exclude.join(',')}`);
        return exclude.length === 0 ? (over.plain ?? answered([])) : (over.excluding ?? answered([]));
      },
      unpushedPatches: async (_path, upstream) => {
        calls.push(`patches ${upstream}`);
        return over.patches ?? answered([]);
      },
    },
    host: {
      prMergedHeads: async (branch) => {
        calls.push(`heads ${branch}`);
        return over.heads ?? answered([]);
      },
    },
    holdsCommit: async (_worktree, sha) => (over.held ?? []).includes(sha),
  };
  return { value, calls };
};

describe('unpushedAfterMerge', () => {
  it('answers unknown where the plain range cannot be read', async () => {
    const { value } = ports({ plain: failed() });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'main')).toBe('unknown');
  });

  it('answers none without asking the host where the plain range is empty', async () => {
    const { value, calls } = ports({});
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'main')).toEqual([]);
    expect(calls).toEqual(['commits ']);
  });

  it('answers the plain range for a branch that did not merge', async () => {
    const { value, calls } = ports({ plain: answered(['abc1234']) });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', false, 'main')).toEqual(['abc1234']);
    expect(calls).toEqual(['commits ']);
  });

  it('answers the plain range where no branch is named', async () => {
    const { value } = ports({ plain: answered(['abc1234']) });
    expect(await unpushedAfterMerge(value, '/d', '', true, 'main')).toEqual(['abc1234']);
  });

  it('answers unknown where the host cannot name the merged heads', async () => {
    const { value } = ports({ plain: answered(['abc1234']), heads: failed() });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'main')).toBe('unknown');
  });

  it('excludes the merged heads the checkout holds', async () => {
    const { value, calls } = ports({
      plain: answered(['abc1234', 'def5678']),
      heads: answered(['held', 'absent']),
      held: ['held'],
      excluding: answered(['def5678']),
    });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'main')).toEqual(['def5678']);
    expect(calls).toEqual(['commits ', 'heads feature/x', 'commits held']);
  });

  it('compares by patch id against the default branch where the checkout holds no merged head', async () => {
    const { value, calls } = ports({ plain: answered(['abc1234']), heads: answered(['absent']), patches: answered([]) });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'trunk')).toEqual([]);
    expect(calls).toEqual(['commits ', 'heads feature/x', 'patches origin/trunk']);
  });

  it('answers unknown where the second reading fails', async () => {
    const { value } = ports({ plain: answered(['abc1234']), patches: failed() });
    expect(await unpushedAfterMerge(value, '/d', 'feature/x', true, 'main')).toBe('unknown');
  });
});
