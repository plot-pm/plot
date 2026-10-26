import { describe, expect, it } from 'vitest';
import type { PlanStore, PortResult } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { bookBrief, type BriefBookContext, parseBriefBookArgs } from '../../src/server/entry/brief-book.js';
import { Refused } from '../../src/server/entry/ladder.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

const TMPWT = '/repo/.worktrees/.plot-brief-book-foo.42';
const PLAN = 'docs/plans/2099-01-01-a.md';
const BRIEF_REL = '.plot/briefs/foo.md';
const PLAN_TEXT = '# A\n\n## Slices\n\n### Fix\n\n- `bug/foo` — do the thing\n\n## Status\n\n- **Started:**\n';

/** An in-memory plan store over `files`, parsing a plan's slices from its bullets. */
const storeOver = (files: Map<string, string>): PlanStore =>
  ({
    config: async (_key: string, fallback: string) => answered(fallback),
    listDir: async (dir: string) =>
      answered([...files.keys()].filter((f) => f.startsWith(dir)).map((f) => f.slice(dir.length))),
    readText: async (file: string) => answered(files.get(file) ?? null),
    writeText: async (file: string, content: string) => {
      files.set(file, content);
      return answered(undefined);
    },
    readPlans: async (paths: readonly string[]) =>
      answered(
        paths.map((file) => ({
          file,
          slices: [{ name: 'Fix', branches: [...(files.get(file) ?? '').matchAll(/^- `([^`]+)`/gm)].map((m) => ({ branch: m[1] })) }],
        })) as unknown as PlanRecord[],
      ),
  }) as unknown as PlanStore;

/** A context whose trees record each call and track real staged state, and whose push lands clean. */
const contextOver = (files: Map<string, string>, calls: string[]): BriefBookContext => {
  let staged = false;
  return {
    repoRoot: '/repo',
    pid: 42,
    planStoreAt: () => storeOver(files),
    retryWait: async () => {},
    scripts: {
      awaited: async (name: string, args: string[]) => {
        calls.push(`${name} ${args.join(' ')}`);
        return { stdout: 'push: clean — plot/brief-book-foo → main\n', stderr: '', code: 0 };
      },
    } as unknown as Scripts,
    trees: {
      originHead: async () => answered('main'),
      fetch: async () => answered(undefined),
      mainRoot: async () => answered('/repo'),
      excludePath: async () => answered(undefined),
      addBranch: async (path: string, branch: string, start: string) => {
        calls.push(`addBranch ${path} ${branch} ${start}`);
        return answered(undefined);
      },
      stage: async (path: string, specs: readonly string[]) => {
        calls.push(`stage ${path} ${specs.join(' ')}`);
        staged = true;
        return answered(undefined);
      },
      hasStagedChanges: async () => answered(staged),
      userName: async () => answered('Plot Test'),
      commitAs: async (path: string, who: string, message: string) => {
        calls.push(`commitAs ${path} ${who} ${message}`);
        return answered(undefined);
      },
      removeWithBranch: async (path: string, branch: string) => {
        calls.push(`removeWithBranch ${path} ${branch}`);
        return answered(undefined);
      },
    } as unknown as Trees,
  };
};

describe('parseBriefBookArgs', () => {
  it('accepts a slug, a branch and a readable brief file', () => {
    expect(parseBriefBookArgs(['foo', 'bug/foo', '/tmp/brief.md'], () => 'brief text')).toEqual({
      slug: 'foo',
      branch: 'bug/foo',
      briefText: 'brief text',
    });
  });

  it('answers the usage line when an argument is missing', () => {
    expect(parseBriefBookArgs(['foo', 'bug/foo'])).toMatch(/^usage: plot-brief-book\.sh/);
  });

  it('refuses a brief file it cannot read', () => {
    expect(
      parseBriefBookArgs(['foo', 'bug/foo', '/tmp/missing.md'], () => {
        throw new Error('ENOENT');
      }),
    ).toBe('could not read brief text from /tmp/missing.md');
  });
});

describe('bookBrief', () => {
  it('writes the brief, inserts the Started line, commits, pushes, then removes the worktree', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];
    const out: string[] = [];

    const code = await bookBrief(contextOver(files, calls), { slug: 'foo', branch: 'bug/foo', briefText: 'the brief' }, (s) => out.push(s));

    expect(code).toBe(0);
    expect(files.get(BRIEF_REL)).toBe('the brief');
    expect(files.get(PLAN)).toContain('`bug/foo`');
    expect(files.get(PLAN)).toMatch(/\*\*Started:\*\* \d{4}-\d{2}-\d{2}, Plot Test, `bug\/foo`/);
    expect(calls).toEqual([
      `addBranch ${TMPWT} plot/brief-book-foo origin/main`,
      `stage ${TMPWT} ${BRIEF_REL}`,
      `stage ${TMPWT} ${PLAN}`,
      expect.stringMatching(/^commitAs .* Plot Test plot: book the brief and plan start for foo$/),
      'plot-push-main.sh plot/brief-book-foo main',
      `removeWithBranch ${TMPWT} plot/brief-book-foo`,
    ]);
    expect(out.join('')).toMatch(/push: clean/);
  });

  it('writes no second commit once the brief and Started line are already on the ref', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const booked = PLAN_TEXT.replace('- **Started:**', `- **Started:** ${date}, Plot Test, \`bug/foo\``);
    const files = new Map([[PLAN, booked], [BRIEF_REL, 'the brief']]);
    const calls: string[] = [];

    const code = await bookBrief(contextOver(files, calls), { slug: 'foo', branch: 'bug/foo', briefText: 'the brief' }, () => {});

    expect(code).toBe(0);
    expect(calls.some((c) => c.startsWith('stage') || c.startsWith('commitAs'))).toBe(false);
    expect(calls.some((c) => c.startsWith('plot-push-main.sh'))).toBe(false);
    expect(calls.at(-1)).toBe(`removeWithBranch ${TMPWT} plot/brief-book-foo`);
  });

  it('refuses a branch no plan names, and still removes the booking worktree', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];

    await expect(
      bookBrief(contextOver(files, calls), { slug: 'other', branch: 'bug/other', briefText: 'x' }, () => {}),
    ).rejects.toThrow(new Refused("no plan in docs/plans/ names branch 'bug/other'"));
    expect(calls.at(-1)).toBe('removeWithBranch /repo/.worktrees/.plot-brief-book-other.42 plot/brief-book-other');
    expect(calls.some((c) => c.startsWith('commitAs'))).toBe(false);
  });

  it('never stages or commits outside the booking worktree', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];

    await bookBrief(contextOver(files, calls), { slug: 'foo', branch: 'bug/foo', briefText: 'the brief' }, () => {});

    for (const call of calls.filter((c) => c.startsWith('stage') || c.startsWith('commitAs'))) {
      expect(call.split(' ')[1]).toBe(TMPWT);
    }
  });
});
