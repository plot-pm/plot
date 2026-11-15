import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Pr } from '@plot-pm/domain';
import { answered } from '@plot-pm/domain';
import { mergeAt as realMergeAt } from '@plot-pm/domain/workflows/merge';

import type { MergePorts } from '../../src/server/entry/merge.js';

/**
 * `plot-ask.mjs merge` REFUSES AN UNANSWERED HUMAN COMMENT.
 *
 * The entry's `mergeAt` is wrapped so the domain's real workflow runs over the
 * ports the entry composes, with only the host and the script port replaced:
 * a green, reviewed PR whose conversation holds a person's comment.
 */

const HEAD = 'a'.repeat(40);
const hostSaid = vi.fn(async (_args: string[]) => ({ answer: 'answered', said: '' }));
let conversation: unknown;

vi.mock('../../src/server/entry/merge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/entry/merge.js')>();
  return {
    ...actual,
    mergeAt: vi.fn(async (ports: MergePorts, pr: number, sha: string) =>
      realMergeAt(
        {
          ...ports,
          stateSync: undefined,
          defaultBranch: { read: async () => answered(null) } as unknown as MergePorts['defaultBranch'],
          host: {
            backend: async () => answered('github'),
            prState: async () => answered(prFixture),
            prReview: async () => answered({ sha: HEAD, state: 'success', description: '', time: '', bypass: false }),
            reviewWriter: async () => answered(''),
            prConversation: async () => conversation,
          } as unknown as MergePorts['host'],
          scripts: { hostSaid } as unknown as MergePorts['scripts'],
        },
        pr,
        sha,
      ),
    ),
  };
});

const { run } = await import('../../src/server/entry/main.js');

const prFixture: Pr = {
  number: 7, repo: '', head: 'feature/x', base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
  draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
  url: '', author: '', headSha: HEAD, checksSha: HEAD,
};

const savedRoot = process.env.PLOT_REPO_ROOT;
const savedUnattended = process.env.PLOT_UNATTENDED;
beforeEach(() => {
  // A fleet worker's env marks the caller unattended, which refuses before any read.
  delete process.env.PLOT_UNATTENDED;
});
afterEach(() => {
  if (savedUnattended === undefined) delete process.env.PLOT_UNATTENDED;
  else process.env.PLOT_UNATTENDED = savedUnattended;
  hostSaid.mockClear();
  if (savedRoot === undefined) delete process.env.PLOT_REPO_ROOT;
  else process.env.PLOT_REPO_ROOT = savedRoot;
});

describe('plot-ask merge and an unanswered comment', () => {
  it('prints human-comment-open, exits 1 and merges nothing', async () => {
    conversation = answered({
      prAuthor: 'jan',
      rows: [{ kind: 'issue', id: 1, login: 'max', type: 'User', time: '2026-11-09T14:32:00Z', body: 'why not CC-0?' }],
    });
    const out: string[] = [];
    expect(await run(['merge', '7', HEAD], import.meta.dirname, (s: string) => { out.push(s); })).toBe(1);
    expect(JSON.parse(out.join(''))).toMatchObject({ merged: false, reason: 'human-comment-open' });
    expect(hostSaid).not.toHaveBeenCalled();
  });
});
