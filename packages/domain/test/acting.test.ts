// The one act a report may take, decided over values.
//
// EVERY BRANCH HERE IS REACHABLE FROM A PLAIN CALL. The decision is a function
// of the finding and the branch reading, so the case a real machine will not
// produce on demand — a host that already holds a PR, a branch acted on one
// message ago — is as easy to state as the ordinary one.
import { describe, it, expect } from 'vitest';
import { ACTS, actOn, isAct, prBody, prTitle } from '../src/rules/acting.js';
import { FindingNameSchema, type Finding, type FindingName } from '../src/entities/finding.js';

/** One reading; every test names the ONE field it changes. */
const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: 'feature/the-ports-have-adapters',
  worktree: '/w/ports',
  finding: 'owes a review',
  since: '2026-08-30T09:00:00Z',
  evidence: 'the branch carries commits, the tree is clean and no PR exists',
  measuredAt: '2026-08-30T09:05:00Z',
  ...over,
});

/** A branch nobody has acted on, with no PR and no open gate. */
const fresh = { hasPr: false, actedThisRun: false, openGate: '' };

describe('which findings license an act', () => {
  it('opens a PR on `owes a review`', () => {
    const decision = actOn(finding(), fresh);

    expect(isAct(decision)).toBe(true);
    expect(decision.act).toBe('open a pr');
    expect(decision.branch).toBe('feature/the-ports-have-adapters');
  });

  it('licenses `owes a review` and nothing else', () => {
    const licensed = FindingNameSchema.options.filter((name: FindingName) => name in ACTS);

    expect(licensed).toEqual(['owes a review']);
  });

  it.each(
    FindingNameSchema.options.filter((name: FindingName) => name !== 'owes a review'),
  )('takes no act on `%s`', (name) => {
    const decision = actOn(finding({ finding: name }), fresh);

    expect(isAct(decision)).toBe(false);
    expect(decision.act).toBe('nothing');
  });

  it('names the finding in its refusal, so a log says why nothing happened', () => {
    const decision = actOn(finding({ finding: 'idle' }), fresh);

    expect(isAct(decision)).toBe(false);
    if (!isAct(decision)) expect(decision.reason).toContain('idle');
  });

  it('refuses a finding that names no branch', () => {
    const decision = actOn(finding({ branch: '' }), fresh);

    expect(isAct(decision)).toBe(false);
  });
});

// THE CLAUSE THAT BITES. The finding holds until the PR appears and the channel
// republishes on every interval, so an act that fired per MESSAGE would open a
// PR a minute until somebody noticed.
describe('a second finding for the same branch opens nothing', () => {
  it('opens nothing once a PR exists', () => {
    const decision = actOn(finding(), { ...fresh, hasPr: true });

    expect(isAct(decision)).toBe(false);
    if (!isAct(decision)) expect(decision.reason).toContain('already has a PR');
  });

  it('opens nothing when this run already opened one', () => {
    const decision = actOn(finding(), { ...fresh, actedThisRun: true });

    expect(isAct(decision)).toBe(false);
    if (!isAct(decision)) expect(decision.reason).toContain('already opened');
  });

  it('decides from the reading, not from how many times it was asked', () => {
    const same = finding();
    const first = actOn(same, fresh);
    const tenth = actOn(same, { ...fresh, hasPr: true });

    expect(isAct(first)).toBe(true);
    expect(isAct(tenth)).toBe(false);
  });
});

describe('what the PR says', () => {
  it('titles the PR from the branch, without its prefix', () => {
    expect(prTitle('feature/a-report-can-open-the-pr')).toBe('A report can open the pr');
    expect(prTitle('bug/a-monitor-ends-with-its-agent')).toBe('A monitor ends with its agent');
  });

  it('falls back to the branch where there is nothing to make a sentence from', () => {
    expect(prTitle('main')).toBe('Main');
    expect(prTitle('feature/')).toBe('feature/');
  });

  it('names the finding, its evidence and when it was measured', () => {
    const body = prBody(finding(), '');

    expect(body).toContain('owes a review');
    expect(body).toContain('the branch carries commits, the tree is clean and no PR exists');
    expect(body).toContain('2026-08-30T09:05:00Z');
    expect(body).toContain('AgentMonitor');
  });

  it('says a person did not ask for it', () => {
    expect(prBody(finding(), '')).toContain('master agent');
  });

  // A BRANCH THAT ALSO OWES A GATE STILL GETS ITS PR, and the body names the
  // gate. Withholding it would leave finished work invisible until somebody
  // happens to write the changeset — the failure this plan ends one step later.
  it('names the open gate and opens the PR anyway', () => {
    const decision = actOn(finding(), { ...fresh, openGate: 'no `.changeset/*.md`' });

    expect(isAct(decision)).toBe(true);
    if (isAct(decision)) expect(decision.body).toContain('no `.changeset/*.md`');
  });

  it('says nothing about a gate when none is open', () => {
    expect(prBody(finding(), '')).not.toContain('Open gate');
  });

  // IT DOES NOT WRITE THE MISSING CHANGESET. The body may say a changeset is
  // missing; it may not contain one.
  it('writes no changeset frontmatter into the body', () => {
    const body = prBody(finding(), 'the branch adds no `.changeset/*.md`');

    expect(body).not.toMatch(/^---$/m);
    expect(body).not.toContain("'plot':");
    expect(body).toContain('a judgement about what changed');
  });
});
