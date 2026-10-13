import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { trackerFixture } from '@plot-pm/domain/adapters/tracker/tracker-fixture';
import { trackerNone } from '@plot-pm/domain/adapters/tracker/tracker-none';
import { trackerGitHost } from '@plot-pm/domain/adapters/tracker/tracker-resolve';
import { foldVerification, verificationBody } from '@plot-pm/domain/rules/verification';
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
    expect(JSON.parse(readFileSync(file, 'utf8')).issues).toEqual({ one: (id as { issue: string }).issue });
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
    expect(() => readFileSync(file, 'utf8')).toThrow();
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
    expect(() => readFileSync(file, 'utf8')).toThrow();
  });
});
