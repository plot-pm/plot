import { describe, expect, it } from 'vitest';

import { issueAbsence, issueSource } from '../src/rules/issue-source.js';

describe('who answers the open-issue list', () => {
  it.each(['github', 'bitbucket'])('asks the %s git host where no tracker is declared', (gitHost) => {
    expect(issueSource({ declared: '', gitHost })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: '   ', gitHost })).toEqual({ ask: 'git-host' });
  });

  it('asks Jira, and not the git host, where Jira is declared', () => {
    // The issue's case: a Bitbucket repository whose tickets live in Jira.
    expect(issueSource({ declared: 'jira https://acme.atlassian.net', gitHost: 'bitbucket' }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
    expect(issueSource({ declared: 'Jira', gitHost: 'github' }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
  });

  it('asks GitHub issues only where GitHub is the git host', () => {
    expect(issueSource({ declared: 'github-issues', gitHost: 'github' }))
      .toEqual({ ask: 'tracker', scheme: 'github-issues' });
    const off = issueSource({ declared: 'github-issues', gitHost: 'bitbucket' });
    expect(off.ask).toBe('nobody');
    expect(off.ask === 'nobody' && off.reason).toMatch(/git host is `bitbucket`/);
  });

  it('asks nobody where the plans are the tracker', () => {
    const plans = issueSource({ declared: 'plot', gitHost: 'bitbucket' });
    expect(plans.ask).toBe('nobody');
    expect(plans.ask === 'nobody' && plans.reason).toMatch(/`Tracker: plot`/);
  });

  it('never falls back to the git host for a tracker no connector lists', () => {
    const linear = issueSource({ declared: 'linear https://linear.app/acme', gitHost: 'bitbucket' });
    expect(linear).toEqual({
      ask: 'nobody',
      reason: 'no connector lists issues from the declared tracker `linear`, and the git host is not asked in its place',
    });
  });
});

describe('the sentence an unaskable issue list shows', () => {
  it('names the reason the script gave, without the script prefix', () => {
    expect(issueAbsence('plot-host: bb 1.9.0 lists no issue command'))
      .toBe('Open issues are not listed: bb 1.9.0 lists no issue command');
  });

  it('names the reason the rule gave', () => {
    const plans = issueSource({ declared: 'plot', gitHost: 'github' });
    expect(plans.ask === 'nobody' && issueAbsence(plans.reason)).toMatch(
      /^Open issues are not listed: this repository's plans are its tracker/,
    );
  });

  it('says the host has no issue tracker where nothing was said', () => {
    expect(issueAbsence('')).toBe('Open issues are not listed: this host has no issue tracker.');
  });

  it('never reads as a list that could not be read', () => {
    expect(issueAbsence('plot-host: anything')).not.toMatch(/could not be read|incomplete/);
  });
});
