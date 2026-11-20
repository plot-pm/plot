import { describe, expect, it } from 'vitest';

import {
  issueAbsence, issueSource, sprintOwner, type HostIssueLister, type IssueLister,
} from '../src/rules/issue-source.js';

// The vendor tables are readings the caller supplies; the adapters hold the
// real ones beside the tracker connectors.
const listers: readonly IssueLister[] = [
  { scheme: 'jira' },
  { scheme: 'github-issues', onlyOnHost: 'github' },
];
const hosts: readonly HostIssueLister[] = [
  { backend: 'github', assignees: { service: 'github', match: 'host-login' } },
];

describe('who answers the open-issue list', () => {
  it('asks the git host where no tracker is declared and the host keeps issues', () => {
    expect(issueSource({ declared: '', gitHost: 'github', listers, hosts })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: '   ', gitHost: 'github', listers, hosts })).toEqual({ ask: 'git-host' });
  });

  it('asks the git host where the tracker is declared `plot`, same as none', () => {
    expect(issueSource({ declared: 'plot', gitHost: 'github', listers, hosts })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: 'Plot', gitHost: 'github', listers, hosts })).toEqual({ ask: 'git-host' });
    expect(issueSource({ declared: 'plot extra', gitHost: 'github', listers, hosts })).toEqual({ ask: 'git-host' });
  });

  it('asks an unresolved git host, which the caller resolves when it asks', () => {
    expect(issueSource({ declared: '', gitHost: '', listers, hosts })).toEqual({ ask: 'git-host' });
  });

  it('answers nobody for a git host with no issue list, and tells an empty declaration to declare a tracker', () => {
    // Bitbucket Cloud keeps no issues, so the adapters' host table omits it.
    expect(issueSource({ declared: '', gitHost: 'bitbucket', listers, hosts })).toEqual({
      ask: 'nobody',
      reason: 'the git host `bitbucket` has no issue list to read; declare the issue tracker with the `Tracker` config key',
    });
  });

  it('names the working pair where `Tracker: plot` is declared on a git host with no issue list', () => {
    expect(issueSource({ declared: 'plot', gitHost: 'bitbucket', listers, hosts })).toEqual({
      ask: 'nobody',
      reason:
        'the git host `bitbucket` has no issue list to read; ' +
        'declare `Tracker: jira <base URL>` with `Sprint owner: plot`',
    });
  });

  it('suggests only a tracker that lists from any git host, and asks for a declaration where none does', () => {
    const hostBound: readonly IssueLister[] = [{ scheme: 'github-issues', onlyOnHost: 'github' }];
    const none = issueSource({ declared: 'plot', gitHost: 'bitbucket', listers: hostBound, hosts });
    expect(none.ask === 'nobody' && none.reason).toMatch(/declare the issue tracker with the `Tracker` config key$/);
    expect(none.ask === 'nobody' && none.reason).not.toMatch(/Sprint owner/);
  });

  it('never names bb or a CLI version in the reason', () => {
    const none = issueSource({ declared: '', gitHost: 'bitbucket', listers, hosts });
    expect(none.ask === 'nobody' && none.reason).not.toMatch(/\bbb\b|craftamap|issue command/);
  });

  it('never falls back to the git host for a scheme that only starts with `plot`', () => {
    expect(issueSource({ declared: 'plotter', gitHost: 'github', listers, hosts }).ask).toBe('nobody');
    expect(issueSource({ declared: 'plot-x', gitHost: 'github', listers, hosts }).ask).toBe('nobody');
  });

  it('asks a listed tracker, and not the git host, where it is declared', () => {
    // The issue's case: a Bitbucket repository whose tickets live in Jira.
    expect(issueSource({ declared: 'jira https://acme.atlassian.net', gitHost: 'bitbucket', listers, hosts }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
    expect(issueSource({ declared: 'Jira', gitHost: 'github', listers, hosts }))
      .toEqual({ ask: 'tracker', scheme: 'jira' });
  });

  it('asks a host-bound tracker only on its own git host', () => {
    expect(issueSource({ declared: 'github-issues', gitHost: 'github', listers, hosts }))
      .toEqual({ ask: 'tracker', scheme: 'github-issues' });
    expect(issueSource({ declared: 'github-issues', gitHost: 'bitbucket', listers, hosts })).toEqual({
      ask: 'nobody',
      reason:
        'the declared tracker `github-issues` lists issues only where the git host is `github`, ' +
        "and this repository's git host is `bitbucket`",
    });
  });

  it('never falls back to the git host for a tracker no connector lists', () => {
    expect(issueSource({ declared: 'linear https://linear.app/acme', gitHost: 'bitbucket', listers, hosts })).toEqual({
      ask: 'nobody',
      reason: 'no connector lists issues from the declared tracker `linear`, and the git host is not asked in its place',
    });
  });

  it('reads the tables it is given, and holds no list of its own', () => {
    expect(issueSource({ declared: 'jira', gitHost: 'bitbucket', listers: [], hosts }).ask).toBe('nobody');
    expect(issueSource({ declared: 'acme', gitHost: 'bitbucket', listers: [{ scheme: 'acme' }], hosts }))
      .toEqual({ ask: 'tracker', scheme: 'acme' });
    expect(issueSource({ declared: '', gitHost: 'github', listers, hosts: [] }).ask).toBe('nobody');
    expect(issueSource({ declared: '', gitHost: 'acme', listers, hosts: [{ backend: 'acme', assignees: { service: 'acme', match: 'host-login' } }] }))
      .toEqual({ ask: 'git-host' });
  });
});

describe('the sentence an unaskable issue list shows', () => {
  it('names the reason the script gave, without the script prefix', () => {
    expect(issueAbsence('plot-host: the git host `bitbucket` has no issue list to read'))
      .toBe('Open issues are not listed: the git host `bitbucket` has no issue list to read');
  });

  it('names the reason the rule gave', () => {
    const none = issueSource({ declared: 'linear', gitHost: 'github', listers, hosts });
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
