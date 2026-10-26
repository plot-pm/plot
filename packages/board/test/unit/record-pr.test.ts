import { describe, expect, it } from 'vitest';
import type { PlanStore, PortResult } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { Refused } from '../../src/server/entry/ladder.js';
import { parseRecordPrArgs, recordPr, type RecordPrContext } from '../../src/server/entry/record-pr.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

const TMPWT = '/repo/.worktrees/.plot-record-pr-foo.42';
const PLAN = 'docs/plans/2099-01-01-a.md';
const PLAN_TEXT = '# A\n\n## Slices\n\n### Fix\n\n- `bug/foo` — do the thing\n';

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

/** A context whose trees record each call, and whose push lands clean. */
const contextOver = (files: Map<string, string>, calls: string[]): RecordPrContext => ({
  repoRoot: '/repo',
  pid: 42,
  planStoreAt: () => storeOver(files),
  retryWait: async () => {},
  scripts: {
    awaited: async (name: string, args: string[]) => {
      calls.push(`${name} ${args.join(' ')}`);
      return { stdout: 'push: clean — plot/record-pr-foo → main\n', stderr: '', code: 0 };
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
      return answered(undefined);
    },
    hasStagedChanges: async () => answered(true),
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
});

describe('parseRecordPrArgs', () => {
  it('accepts a branch and a numeric PR number', () => {
    expect(parseRecordPrArgs(['bug/foo', '42'])).toEqual({ branch: 'bug/foo', pr: '42' });
  });

  it('answers the usage line when an argument is missing', () => {
    expect(parseRecordPrArgs(['bug/foo'])).toMatch(/^usage: plot-record-pr\.sh/);
  });

  it('refuses a PR number that is not all digits', () => {
    expect(parseRecordPrArgs(['bug/foo', '#42'])).toBe("<pr-number> must be numeric, got '#42'");
  });
});

describe('recordPr', () => {
  it('edits, stages, commits and pushes in the booking worktree, then removes it', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];
    const out: string[] = [];

    const code = await recordPr(contextOver(files, calls), { branch: 'bug/foo', pr: '42' }, (s) => out.push(s));

    expect(code).toBe(0);
    expect(files.get(PLAN)).toContain('- `bug/foo` — do the thing → #42');
    expect(calls).toEqual([
      `addBranch ${TMPWT} plot/record-pr-foo origin/main`,
      `stage ${TMPWT} ${PLAN}`,
      `commitAs ${TMPWT} Plot Test plot: record PR #42 for foo`,
      'plot-push-main.sh plot/record-pr-foo main',
      `removeWithBranch ${TMPWT} plot/record-pr-foo`,
    ]);
    expect(out.join('')).toMatch(/push: clean/);
  });

  it('refuses a branch no plan names, and still removes the booking worktree', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];

    await expect(recordPr(contextOver(files, calls), { branch: 'bug/other', pr: '1' }, () => {})).rejects.toThrow(
      new Refused("no plan in docs/plans/ names branch 'bug/other'"),
    );
    expect(calls.at(-1)).toBe(`removeWithBranch /repo/.worktrees/.plot-record-pr-other.42 plot/record-pr-other`);
    expect(calls.some((c) => c.startsWith('commitAs'))).toBe(false);
  });

  it('refuses a line that already carries a PR annotation, and writes nothing', async () => {
    const annotated = PLAN_TEXT.replace('do the thing', 'do the thing → #7');
    const files = new Map([[PLAN, annotated]]);
    const calls: string[] = [];

    await expect(recordPr(contextOver(files, calls), { branch: 'bug/foo', pr: '8' }, () => {})).rejects.toThrow(
      /already carries a PR annotation on the bug\/foo line/,
    );
    expect(files.get(PLAN)).toBe(annotated);
    expect(calls.some((c) => c.startsWith('stage') || c.startsWith('commitAs'))).toBe(false);
  });

  it('never stages or commits outside the booking worktree', async () => {
    const files = new Map([[PLAN, PLAN_TEXT]]);
    const calls: string[] = [];

    await recordPr(contextOver(files, calls), { branch: 'bug/foo', pr: '42' }, () => {});

    for (const call of calls.filter((c) => c.startsWith('stage') || c.startsWith('commitAs'))) {
      expect(call.split(' ')[1]).toBe(TMPWT);
    }
  });
});
