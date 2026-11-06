import { describe, it, expect } from 'vitest';
import { releaseApprove, releaseApproveAt, type ReleaseApproveReadings } from '../src/workflows/release-approve.js';
import type { MergePorts } from '../src/workflows/merge.js';
import type { Pr } from '../src/entities/pr.js';
import type { PrReviewReading } from '../src/ports/host.js';
import type { FileChange } from '../src/ports/refs.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CLOCK = { minHexLen: 7 };

/** An open release PR, reviewed and green on its head — every refusal passes. */
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 42,
  repo: '',
  head: 'changeset-release/main',
  base: 'main',
  state: 'OPEN',
  mergedAt: null,
  mergeCommit: '',
  draft: false,
  mergeable: 'mergeable',
  review: '',
  checks: 'green',
  failingChecks: [],
  url: '',
  author: '',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  ...over,
});

const review = (over: Partial<PrReviewReading> = {}): PrReviewReading => ({
  sha: HEAD,
  state: 'success',
  description: '',
  time: '',
  bypass: false,
  ...over,
});

const PROOF = { credentialId: 'cred-1' } as const;

const readings = (over: Partial<ReleaseApproveReadings> = {}): ReleaseApproveReadings => ({
  caller: 'person',
  personProof: PROOF,
  pr: pr(),
  review: review(),
  ciAsked: true,
  ...over,
});

const edit = (path: string, removed: string, added: string, section = ''): FileChange =>
  ({ path, status: 'modified', hunks: [{ section, removed: [removed], added: [added] }] });
const VERSION_STEP: readonly FileChange[] = [
  { path: '.changeset/a.md', status: 'deleted', hunks: [] },
  edit('package.json', '  "version": "2.30.0",', '  "version": "2.31.0",'),
  edit('skills/plot/SKILL.md', '  version: 0.19.0', '  version: 0.20.0', 'metadata:'),
];

const refusalOf = (r: ReleaseApproveReadings, sha = HEAD, minHexLen = CLOCK.minHexLen) => {
  const out = releaseApprove(r, { pr: 42, sha, minHexLen });
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('releaseApprove — the controller for a release PR approval', () => {
  it('refuses an unattended caller before any other reading is asked', () => {
    expect(refusalOf(readings({ caller: 'unattended', pr: 'unaskable' }))).toBe('unattended');
  });

  it('refuses a PR whose branch is not a release branch', () => {
    expect(refusalOf(readings({ pr: pr({ head: 'feature/x' }) }))).toBe('not-release-pr');
  });

  it('does not match a feature branch that merely contains the release segment', () => {
    // catches an `includes` check standing in for the anchored prefix.
    expect(refusalOf(readings({ pr: pr({ head: 'feature/changeset-release-notes' }) }))).toBe('not-release-pr');
  });

  it('refuses a host head that has moved past the sha the caller approved', () => {
    expect(refusalOf(readings({ pr: pr({ headSha: OTHER }) }))).toBe('head-moved');
  });

  it('refuses an absent review', () => {
    expect(refusalOf(readings({ review: 'unaskable' }))).toBe('review-missing');
  });

  it('refuses a failing review on the current head', () => {
    expect(refusalOf(readings({ review: review({ state: 'failure' }) }))).toBe('review-missing');
  });

  it('refuses a success recorded on an older sha when the head has since moved', () => {
    // catches reading the status without checking its sha.
    expect(refusalOf(readings({ review: review({ sha: OTHER, state: 'success' }) }))).toBe('review-missing');
  });

  it('a release PR whose rollup holds only plot/review success refuses checks-missing', () => {
    expect(refusalOf(readings({ pr: pr({ ciChecks: 'none' }) }))).toBe('checks-missing');
    expect(refusalOf(readings({ pr: pr({ ciChecks: 'pending' }) }))).toBe('checks-missing');
    expect(refusalOf(readings({ pr: pr({ ciChecks: 'unknown' }) }))).toBe('checks-missing');
    const { ciChecks: _omitted, ...bare } = pr();
    expect(refusalOf(readings({ pr: bare }))).toBe('checks-missing');
    expect(refusalOf(readings({ pr: pr({ checksSha: OTHER }) }))).toBe('checks-missing');
  });

  it('a release PR whose required validate succeeded on the pinned head passes the checks rule', () => {
    expect(refusalOf(readings({ pr: pr({ ciChecks: 'green' }) }))).toBe('decided');
  });

  it('skips the checks rule on a host that reports no CI-only rollup', () => {
    expect(refusalOf(readings({ pr: pr({ ciChecks: 'none' }), ciAsked: false }))).toBe('decided');
  });

  it('decides one approval pinned to the head the caller reviewed', () => {
    const out = releaseApprove(readings(), { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome).not.toBe('refused');
  });

  it('reports an open PR as still to merge', () => {
    const out = releaseApprove(readings(), { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome === 'decided' ? out.detail.alreadyMerged : null).toBe(false);
  });

  it('resumes the finish for a merged release PR without reading its review', () => {
    // a release PR merged in the host's UI has no review reading worth asking for.
    const r = readings({ pr: pr({ state: 'MERGED' }), review: 'unaskable' });
    const out = releaseApprove(r, { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome === 'decided' ? out.detail.alreadyMerged : null).toBe(true);
    expect(out.outcome === 'decided' ? out.writes : null).toEqual([]);
  });

  it('still refuses a merged PR that is not a release PR', () => {
    expect(refusalOf(readings({ pr: pr({ state: 'MERGED', head: 'feature/x' }) }))).toBe('not-release-pr');
  });
});

describe('releaseApprove — the passkey proof', () => {
  it('refuses person-unproven for a person caller with no proof', () => {
    expect(refusalOf(readings({ personProof: 'none' }))).toBe('person-unproven');
  });

  it('refuses unattended before person-unproven', () => {
    expect(refusalOf(readings({ caller: 'unattended', personProof: 'none' }))).toBe('unattended');
  });

  it('refuses person-unproven before any host reading is looked at', () => {
    expect(refusalOf(readings({ personProof: 'none', pr: 'unaskable' }))).toBe('person-unproven');
  });

  it('passes a person caller with a proof to the merge', () => {
    expect(refusalOf(readings())).toBe('decided');
  });
});

describe('releaseApprove — the release head provenance', () => {
  it('passes a head holding only the version step\'s changes', () => {
    expect(refusalOf(readings({ head: VERSION_STEP }))).toBe('decided');
  });

  it('refuses a head that changes .github/workflows/ci.yml, naming the path and the pinned head', () => {
    const r = readings({ head: [...VERSION_STEP, edit('.github/workflows/ci.yml', 'a', 'b')] });
    expect(refusalOf(r)).toBe('release-head-foreign');
    const out = releaseApprove(r, { pr: 42, sha: HEAD, minHexLen: 7 });
    expect((out as { detail: string }).detail).toContain('.github/workflows/ci.yml');
    expect((out as { detail: string }).detail).toContain(HEAD.slice(0, 12));
  });

  it('refuses a head that changes a SKILL.md body line', () => {
    expect(refusalOf(readings({ head: [edit('skills/plot/SKILL.md', 'old', 'new', '## Steps')] }))).toBe('release-head-foreign');
  });

  it('refuses a head that changes a package.json dependency beside the version line', () => {
    const swapped: FileChange = {
      path: 'package.json',
      status: 'modified',
      hunks: [
        { section: '', removed: ['  "version": "2.30.0",'], added: ['  "version": "2.31.0",'] },
        { section: '"dependencies": {', removed: ['    "x": "1.0.0"'], added: ['    "x": "9.0.0"'] },
      ],
    };
    expect(refusalOf(readings({ head: [swapped] }))).toBe('release-head-foreign');
  });

  it('refuses an unread or empty diff as unaskable, never as a clean head', () => {
    expect(refusalOf(readings({ head: 'unaskable' }))).toBe('unaskable');
    expect(refusalOf(readings({ head: [] }))).toBe('unaskable');
  });

  it('refuses a moved head before it reads the diff', () => {
    expect(refusalOf(readings({ head: [edit('x', 'a', 'b')] }), OTHER)).toBe('head-moved');
  });
});

describe('releaseApproveAt — the workflow wired to its ports', () => {
  const NOW = Date.parse('2026-10-11T12:00:00Z');

  /** Ports that answer as given and record every host read and script call. */
  const ports = (lookup: Pr, reviewed: PrReviewReading = review(), changes: unknown = { ok: true, value: VERSION_STEP }, backend = 'github') => {
    const reads: string[] = [];
    const diffed: string[] = [];
    const calls: string[][] = [];
    const p = {
      host: {
        backend: async () => ({ ok: true, value: backend }),
        prState: async () => { reads.push('prState'); return { ok: true, value: lookup }; },
        prReview: async () => { reads.push('prReview'); return { ok: true, value: reviewed }; },
      },
      scripts: { hostSaid: async (args: string[]) => { calls.push(args); return { answer: 'answered', said: '' }; } },
      defaultBranch: { read: async () => ({ ok: true, value: null }) },
      refs: { remoteSha: async () => ({ ok: true, value: 'unknown' }), headChanges: async (sha: string) => { diffed.push(sha); return changes; } },
      checksWaitMs: 3_600_000,
      now: () => NOW,
      caller: 'person',
    } as unknown as MergePorts;
    return { p, reads, calls, diffed };
  };

  it('merges a reviewed release PR pinned to the head the person read', async () => {
    const { p, calls } = ports(pr());
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toEqual({ approved: true, pr: 42, sha: HEAD, alreadyMerged: false });
    expect(calls).toEqual([['pr-merge', '42', '--match-head', HEAD]]);
  });

  it('reads the diff at the pinned sha and merges a clean head', async () => {
    const { p, diffed } = ports(pr());
    expect((await releaseApproveAt(p, 42, HEAD, PROOF)).approved).toBe(true);
    expect(diffed).toEqual([HEAD]);
  });

  it('refuses a foreign head with no host write', async () => {
    const { p, calls } = ports(pr(), review(), { ok: true, value: [edit('.github/workflows/ci.yml', 'a', 'b')] });
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'release-head-foreign' });
    expect(calls).toEqual([]);
  });

  it('refuses where the diff read failed, with no host write', async () => {
    const { p, calls } = ports(pr(), review(), { ok: false, why: 'unaskable' });
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('keeps its behaviour on a host with no release workflows: no diff is read', async () => {
    const { p, diffed } = ports(pr(), review(), { ok: false, why: 'unaskable' }, 'bitbucket');
    expect((await releaseApproveAt(p, 42, HEAD, PROOF)).approved).toBe(true);
    expect(diffed).toEqual([]);
  });

  it('refuses an unattended caller before any host read', async () => {
    const { p, reads, calls } = ports(pr());
    p.caller = 'unattended';
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'unattended' });
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a person caller with no passkey proof before any host read', async () => {
    const { p, reads, calls } = ports(pr());
    expect(await releaseApproveAt(p, 42, HEAD, 'none')).toMatchObject({ approved: false, reason: 'person-unproven' });
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a head that moved after the person read it, with no host write', async () => {
    const { p, calls } = ports(pr({ headSha: OTHER }), review({ sha: OTHER }));
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'head-moved' });
    expect(calls).toEqual([]);
  });

  it('refuses a review recorded on an older sha, with no host write', async () => {
    const { p, calls } = ports(pr({ headSha: OTHER }), review({ sha: HEAD }));
    expect(await releaseApproveAt(p, 42, OTHER, PROOF)).toMatchObject({ approved: false, reason: 'review-missing' });
    expect(calls).toEqual([]);
  });

  it('refuses a PR that is not a release PR, with no host write', async () => {
    const { p, calls } = ports(pr({ head: 'feature/x' }));
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'not-release-pr' });
    expect(calls).toEqual([]);
  });

  it('skips the merge for a release PR the host already holds merged', async () => {
    const { p, calls } = ports(pr({ state: 'MERGED' }));
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toEqual({ approved: true, pr: 42, sha: HEAD, alreadyMerged: true });
    expect(calls).toEqual([]);
  });

  it('carries the merge refusal through when merge holds the PR', async () => {
    const { p, calls } = ports(pr({ checks: 'failing', checksSha: HEAD }));
    expect(await releaseApproveAt(p, 42, HEAD, PROOF)).toMatchObject({ approved: false, reason: 'checks-not-green' });
    expect(calls).toEqual([]);
  });

  it('refuses a PR the host did not answer as unaskable, and a PR or a head it lacks', () => {
    expect(refusalOf(readings({ pr: 'unaskable' }))).toBe('unaskable');
    expect(refusalOf(readings({ pr: null }))).toBe('not-release-pr');
    expect(refusalOf(readings({ pr: pr({ headSha: undefined }) }))).toBe('head-moved');
  });

  it('names no head in the refusal where the host held none', () => {
    const out = releaseApprove(readings({ pr: pr({ headSha: '' }) }), { pr: 42, sha: HEAD, minHexLen: 7 });
    expect(out).toMatchObject({ outcome: 'refused', reason: 'head-moved' });
    expect((out as { detail: string }).detail).toContain('none');
  });
});
