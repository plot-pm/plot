import { describe, expect, it } from 'vitest';
import type { PlanStore, PortResult } from '@plot-pm/domain';
import { findPlanForBranch } from '../../src/server/entry/plan-lookup.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

/** An in-memory store that records which files it was asked to parse. */
const storeOver = (files: Record<string, string>, parsed: string[][]): PlanStore =>
  ({
    listDir: async (dir: string) =>
      answered(Object.keys(files).filter((f) => f.startsWith(dir)).map((f) => f.slice(dir.length))),
    readText: async (file: string) => answered(files[file] ?? null),
    readPlans: async (paths: readonly string[]) => {
      parsed.push([...paths]);
      return answered(
        paths.map((file) => ({
          file,
          slices: [{ name: 'Fix', branches: [...files[file].matchAll(/^- `([^`]+)`/gm)].map((m) => ({ branch: m[1] })) }],
        })),
      );
    },
  }) as unknown as PlanStore;

describe('findPlanForBranch', () => {
  it('parses only the plans that contain the branch name, and answers the one that names it', async () => {
    const parsed: string[][] = [];
    const store = storeOver(
      {
        'docs/plans/a.md': '- `bug/other` — x\n',
        'docs/plans/b.md': '- `bug/foo` — y\n',
        'docs/plans/notes.txt': 'bug/foo\n',
      },
      parsed,
    );

    expect(await findPlanForBranch(store, 'docs/plans/', 'bug/foo')).toEqual({ file: 'docs/plans/b.md', sliceName: 'Fix' });
    expect(parsed).toEqual([['docs/plans/b.md']]);
  });

  it('answers undefined when a plan mentions the branch but no slice names it', async () => {
    const store = storeOver({ 'docs/plans/a.md': 'Mentions bug/foo in prose.\n' }, []);
    expect(await findPlanForBranch(store, 'docs/plans/', 'bug/foo')).toBeUndefined();
  });
});
