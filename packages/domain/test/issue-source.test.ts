import { describe, expect, it } from 'vitest';

import { bbIssueCommandMissing, issueAbsence, issueSource, sprintOwner, type IssueLister } from '../src/rules/issue-source.js';

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

  it.each(['github', 'bitbucket'])('asks the %s git host where the tracker is declared `plot`, same as none', (gitHost) => {
    expect(issueSource({ declared: 'plot', gitHost, listers })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: 'Plot', gitHost, listers })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: 'plot extra', gitHost, listers })).toEqual({ ask: 'git-host' });
  });

  it('never falls back to the git host for a scheme that only starts with `plot`', () => {
    expect(issueSource({ declared: 'plotter', gitHost: 'github', listers }).ask).toBe('nobody');
    expect(issueSource({ declared: 'plot-x', gitHost: 'github', listers }).ask).toBe('nobody');
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

describe('the sentence a bb with no issue command shows', () => {
  it('keeps the advice to declare `Tracker` where the repository declared none', () => {
    expect(bbIssueCommandMissing('')).toMatch(/declare the issue tracker with the `Tracker` config key/);
    expect(bbIssueCommandMissing('   ')).toMatch(/declare the issue tracker with the `Tracker` config key/);
  });

  it('drops the advice where the repository already declared `Tracker`', () => {
    // `Tracker: plot` is the issue's case — the same value `issueSource` reads
    // as "ask the git host" — and a repository tracking elsewhere, e.g. Jira,
    // has equally already made the declaration the advice would ask it to make.
    expect(bbIssueCommandMissing('plot')).not.toMatch(/Tracker/);
    expect(bbIssueCommandMissing('jira https://acme.atlassian.net')).not.toMatch(/Tracker/);
  });

  it('states the same reason regardless of the declaration', () => {
    expect(bbIssueCommandMissing('plot')).toMatch(/^lists no issue command/);
    expect(bbIssueCommandMissing('')).toMatch(/^lists no issue command/);
  });
});

describe('who owns a repository\'s sprints', () => {
  it('owns sprints where neither key is declared, same as today', () => {
    expect(sprintOwner('', '')).toEqual({ owns: 'plot' });
  });

  it('owns sprints where only `Tracker: plot` is declared, same as today', () => {
    expect(sprintOwner('', 'plot')).toEqual({ owns: 'plot' });
  });

  it('declines where only `Tracker: jira <url>` is declared, same as today — the regression this key must not cause', () => {
    expect(sprintOwner('', 'jira https://acme.atlassian.net')).toEqual({ owns: 'external', scheme: 'jira' });
  });

  it('owns sprints where `Sprint owner: plot` is declared beside an external `Tracker` — the combination this key exists for', () => {
    expect(sprintOwner('plot', 'jira https://acme.atlassian.net')).toEqual({ owns: 'plot' });
    expect(sprintOwner('Plot', 'jira https://acme.atlassian.net')).toEqual({ owns: 'plot' });
  });

  it('still declines where `Sprint owner` is declared as anything but `plot`', () => {
    expect(sprintOwner('jira', 'jira https://acme.atlassian.net')).toEqual({ owns: 'external', scheme: 'jira' });
  });

  it('`Sprint owner: plot` with no external `Tracker` decides nothing a bare `Tracker` reading did not already decide', () => {
    expect(sprintOwner('plot', '')).toEqual({ owns: 'plot' });
    expect(sprintOwner('plot', 'plot')).toEqual({ owns: 'plot' });
  });
});
