import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { trackerNone } from '@plot-pm/domain/adapters/tracker/tracker-none';
import { trackerGitHost } from '@plot-pm/domain/adapters/tracker/tracker-resolve';
import { PENDING_REASON } from '@plot-pm/domain/rules/refuted-issues';
import { refutedClaims } from '@plot-pm/domain/rules/verification-record';
import { foldVerification, verificationBody } from '@plot-pm/domain/rules/verification';
import type { IssueOpen } from '@plot-pm/domain';
import { openRefutedIssues } from '../../src/server/entry/verify.js';

const verdictsOf = (claims: string[]) => {
  const fold = foldVerification(claims, [{ lens: 'a', text: claims.map((_, i) => `Claim-${i + 1}: refuted\n`).join('') }]);
  if (fold.fold !== 'record') throw new Error('expected a record');
  return fold.verdicts;
};

describe('a refuted claim opens an issue', () => {
  const roots: string[] = [];
  const stateFile = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-verify-issue-'));
    roots.push(root);
    return path.join(root, 'verify', 'p.json');
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('opens one ai-generated issue and records its id in the state file', async () => {
    const opened: Parameters<ReturnType<typeof trackerFixture>['issueOpen']>[0][] = [];
    const file = stateFile();
    const notes = await openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(opened).toHaveLength(1);
    expect(opened[0]!.labels).toEqual(['ai-generated']);
    const id = [...notes.values()][0];
    expect(JSON.parse(readFileSync(file, 'utf8')).issues).toEqual({ one: { issue: (id as { issue: string }).issue } });
  });

  it('opens nothing for a claim text already in the state file, and opens a changed claim anew', async () => {
    const opened: Parameters<ReturnType<typeof trackerFixture>['issueOpen']>[0][] = [];
    const file = stateFile();
    const tracker = trackerFixture({ scheme: 'jira', opened });
    const first = await openRefutedIssues(tracker, file, 'p', 'abc1234', verdictsOf(['one', 'two']));
    expect(opened).toHaveLength(2);
    // The Changelog is re-read in another order: numbers move, texts do not.
    const again = await openRefutedIssues(tracker, file, 'p', 'abc1234', verdictsOf(['two', 'one', 'three']));
    expect(opened).toHaveLength(3);
    expect(again.get('one')).toEqual(first.get('one'));
    expect(again.get('two')).toEqual(first.get('two'));
    expect(opened[2]!.title).toContain('three');
  });

  it('renders the unaskable reason verbatim and records no number', async () => {
    const file = stateFile();
    const notes = await openRefutedIssues(trackerGitHost('github', { repoRoot: '/', scriptDir: '/' }), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(verificationBody(verdictsOf(['one']), notes)).toBe(
      "- Claim-1 refuted — one — a refuted — no issue: no Tracker declared; the git host's issues are read-only to Plot\n",
    );
    expect(JSON.parse(readFileSync(file, 'utf8')).issues).toEqual({});
    const none = await openRefutedIssues(trackerNone('nobody lists issues'), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(none.get('one')).toEqual({ noIssue: 'nobody lists issues' });
  });

  it('renders a failed write with the full reason and records no number', async () => {
    const file = stateFile();
    const tracker = {
      ...trackerFixture({ scheme: 'jira', issueOpenFails: true }),
      lastRefusal: () => 'the issue may exist: the call ended at its time bound',
    };
    const notes = await openRefutedIssues(tracker, file, 'p', 'abc1234', verdictsOf(['one']));
    expect(notes.get('one')).toEqual({ noIssue: 'the issue may exist: the call ended at its time bound' });
    expect(JSON.parse(readFileSync(file, 'utf8')).issues).toEqual({
      one: { mayExist: 'the issue may exist: the call ended at its time bound' },
    });
  });

  it('opens nothing on a retry after a may-exist failure', async () => {
    const opened: IssueOpen[] = [];
    const file = stateFile();
    const failing = { ...trackerFixture({ scheme: 'jira', opened, issueOpenFails: true }), lastRefusal: () => 'the issue may exist: signal' };
    await openRefutedIssues(failing, file, 'p', 'abc1234', verdictsOf(['one']));
    const again = await openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(opened).toHaveLength(1);
    expect(again.get('one')).toEqual({ noIssue: 'the issue may exist: signal' });
  });

  it('opens again after a plain failure, which keeps no entry', async () => {
    const opened: IssueOpen[] = [];
    const file = stateFile();
    const failing = { ...trackerFixture({ scheme: 'jira', opened, issueOpenFails: true }), lastRefusal: () => null };
    const first = await openRefutedIssues(failing, file, 'p', 'abc1234', verdictsOf(['one']));
    expect(first.get('one')).toEqual({ noIssue: 'jira refused with no reason' });
    const again = await openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(opened).toHaveLength(2);
    expect(again.get('one')).toEqual({ issue: '2' });
  });

  it('opens nothing after a run that ended between the open and the state write', async () => {
    const opened: IssueOpen[] = [];
    const file = stateFile();
    const crashing = {
      ...trackerFixture({ scheme: 'jira', opened }),
      issueOpen: async (write: IssueOpen) => {
        opened.push(write);
        throw new Error('the process ended');
      },
    };
    await expect(openRefutedIssues(crashing, file, 'p', 'abc1234', verdictsOf(['one']))).rejects.toThrow('the process ended');
    expect(JSON.parse(readFileSync(file, 'utf8')).issues).toEqual({ one: { pending: true } });
    const again = await openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']));
    expect(opened).toHaveLength(1);
    expect(again.get('one')).toEqual({ noIssue: PENDING_REASON });
  });

  it('opens nothing for a claim whose plan line already names an issue, with an empty state file', async () => {
    const opened: IssueOpen[] = [];
    const file = stateFile();
    const plan = '# P\n\n## Verification\n\n- Claim-3 refuted — one — b refuted — #1712\n';
    const notes = await openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']), refutedClaims(plan));
    expect(opened).toHaveLength(0);
    expect(verificationBody(verdictsOf(['one']), notes)).toBe('- Claim-1 refuted — one — a refuted — #1712\n');
  });

  it('refuses a state file that does not parse and opens nothing', async () => {
    const opened: IssueOpen[] = [];
    const file = stateFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    await expect(openRefutedIssues(trackerFixture({ scheme: 'jira', opened }), file, 'p', 'abc1234', verdictsOf(['one']))).rejects.toThrow(
      `${file} does not parse as an issue state file`,
    );
    expect(opened).toHaveLength(0);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });
});
