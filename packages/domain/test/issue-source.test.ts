import { describe, expect, it } from 'vitest';

import { issueAbsence, issueSource, type IssueLister } from '../src/rules/issue-source.js';

// The vendor table is a reading the caller supplies; the adapters hold the real
// one beside the tracker connectors.
const listers: readonly IssueLister[] = [
  { scheme: 'jira' },
  { scheme: 'github-issues', onlyOnHost: 'github' },
];

describe('who answers the open-issue list', () => {
  it.each(['github', 'bitbucket'])('asks the %s git host where no tracker is declared', (gitHost) => {
    expect(issueSource({ declared: '', gitHost, listers })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: '   ', gitHost, listers })).toEqual({ ask: 'git-host' });
  });

  it('asks a listed tracker, and not the git host, where it is declared', () => {
    // The issue's case: a Bitbucket repository whose tickets live in Jira.
    expect(issueSource({ declared: 'jira https://acme.atlassian.net', gitHost: 'bitbucket', listers }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
    expect(issueSource({ declared: 'Jira', gitHost: 'github', listers }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
  });

  it('asks a host-bound tracker only on its own git host', () => {
    expect(issueSource({ declared: 'github-issues', gitHost: 'github', listers }))
      .toEqual({ ask: 'tracker', scheme: 'github-issues' });
    expect(issueSource({ declared: 'github-issues', gitHost: 'bitbucket', listers })).toEqual({
      ask: 'nobody',
      reason:
        'the declared tracker `github-issues` lists issues only where the git host is `github`, ' +
        "and this repository's git host is `bitbucket`",
    });
  });

  it('never falls back to the git host for a tracker no connector lists', () => {
    expect(issueSource({ declared: 'linear https://linear.app/acme', gitHost: 'bitbucket', listers })).toEqual({
      ask: 'nobody',
      reason: 'no connector lists issues from the declared tracker `linear`, and the git host is not asked in its place',
    });
    expect(issueSource({ declared: 'plot', gitHost: 'github', listers }).ask).toBe('nobody');
  });

  it('reads the table it is given, and holds no list of its own', () => {
    expect(issueSource({ declared: 'jira', gitHost: 'bitbucket', listers: [] }).ask).toBe('nobody');
    expect(issueSource({ declared: 'acme', gitHost: 'bitbucket', listers: [{ scheme: 'acme' }] }))
      .toEqual({ ask: 'tracker', scheme: 'acme' });
  });
});

describe('the sentence an unaskable issue list shows', () => {
  it('names the reason the script gave, without the script prefix', () => {
    expect(issueAbsence('plot-host: bb 1.9.0 lists no issue command'))
      .toBe('Open issues are not listed: bb 1.9.0 lists no issue command');
  });

  it('names the reason the rule gave', () => {
    const none = issueSource({ declared: 'linear', gitHost: 'github', listers });
    expect(none.ask === 'nobody' && issueAbsence(none.reason)).toMatch(
      /^Open issues are not listed: no connector lists issues from the declared tracker `linear`/,
    );
  });

  it('says the host has no issue tracker where nothing was said', () => {
    expect(issueAbsence('')).toBe('Open issues are not listed: this host has no issue tracker.');
  });

  it('never reads as a list that could not be read', () => {
    expect(issueAbsence('plot-host: anything')).not.toMatch(/could not be read|incomplete/);
  });
});
