import { describe, expect, it } from 'vitest';
import { deskRowFrom, requestFromDeskRows, run } from '../../src/server/entry/reconcile.js';

/**
 * The wire of `plot-reconcile.mjs --desk-rows`: the tab-separated desk rows
 * `plot-reconcile-scan.sh` §21 writes, read into the workspace request.
 */

/** One desk row, as the scan's `printf` writes it. */
const row = (over: Partial<Record<string, string>> = {}) => {
  const f = {
    path: '/repo/.worktrees/one', branch: 'feature/one', dispatch: 'true', unclassified: 'false',
    pid: '', marker: 'false', clean: 'true', isMain: 'false', detached: 'false', merged: 'false',
    claimRef: 'true', markerRecordsWork: 'false', fileChangingCommits: '0', ...over,
  };
  return [
    f.path, f.branch, f.dispatch, f.unclassified, f.pid, f.marker, f.clean, f.isMain, f.detached,
    f.merged, f.claimRef, f.markerRecordsWork, f.fileChangingCommits,
  ].join('\t');
};

/** Runs the entry in desk-rows mode, capturing stdout. */
const ask = (stdin: string) => {
  const out: string[] = [];
  const code = run(stdin, (s) => out.push(s), ['--desk-rows', 'main']);
  return { code, answer: JSON.parse(out.join('')) };
};

describe('reconcile --desk-rows reads the scan’s desk rows', () => {
  it('reads each field into the candidate the rule judges', () => {
    const candidate = deskRowFrom(row({ pid: '42', marker: 'true', merged: 'true', fileChangingCommits: '3' }));
    expect(candidate.tree).toMatchObject({ path: '/repo/.worktrees/one', branch: 'feature/one', clean: true });
    expect(candidate.evidence).toMatchObject({
      workerAlive: true, blockedMarker: true, hasMergedPr: true, isDispatchTree: true,
      claimRef: true, markerRecordsWork: false, fileChangingCommits: 3,
    });
  });

  it('reads a commit count the shell could not take as one, never as zero', () => {
    expect(deskRowFrom(row({ fileChangingCommits: 'unknown' })).evidence.fileChangingCommits).toBe(1);
    expect(deskRowFrom(row({ fileChangingCommits: '' })).evidence.fileChangingCommits).toBe(1);
  });

  it('asks at the workspace scope with the default branch it was given', () => {
    const request = requestFromDeskRows(`${row()}\n\n`, 'trunk');
    expect(request.scope).toEqual({ kind: 'workspace' });
    expect(request.readings.desks.defaultBranch).toBe('trunk');
    expect(request.readings.desks.candidates).toHaveLength(1);
  });

  it('reports an orphaned desk read from a row, and no command for it', () => {
    const { code, answer } = ask(`${row({ claimRef: 'false' })}\n`);
    expect(code).toBe(0);
    expect(answer.detail.findings).toEqual([
      expect.objectContaining({ kind: 'worktree', subject: '/repo/.worktrees/one', evidence: 'orphaned', repair: '' }),
    ]);
  });

  it('reads stdin as one JSON request without the flag', () => {
    const out: string[] = [];
    expect(run(row(), (s) => out.push(s))).toBe(2);
    expect(out).toEqual([]);
  });
});
