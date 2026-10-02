import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../../src/server/entry/issue-source.js';

/**
 * THE TESTS REPLAY 2026-10-01 (#1131).
 *
 * `plot-host.sh`'s `issue-list` and `issue-view` tested `tracker_scheme = jira`
 * and sent every other scheme to the git host, so a repository tracking in
 * Linear was shown GitHub's issues under Linear's name. `issueSource` had
 * decided this since #1132; what was missing was the shell's way to ask it.
 *
 * This entry is that way, so what is asserted here is the WIRE: which of the
 * three words reaches a bash caller, and what an unaskable call looks like.
 * The rule's own eight tests live beside the rule.
 */

/** Runs the entry, capturing stdout rather than emitting it. */
const ask = (gitHost: readonly string[], tracker: string) => {
  const out: string[] = [];
  const code = run(gitHost, tracker, (s) => out.push(s));
  return { code, stdout: out.join('') };
};

describe('the issue-source entry answers who lists a repository\'s issues', () => {
  it('names the tracker a connector lists from', () => {
    expect(ask(['github'], 'jira')).toEqual({ code: EXIT.ok, stdout: 'tracker\tjira\n' });
  });

  it('reads the scheme off a value carrying a base URL', () => {
    // THE REASON THE VALUE ARRIVES ON STDIN. `Tracker: jira https://…` is the
    // declared form, and a URL on a command line is a quoting hazard the shell
    // that read the key should not have to re-solve.
    expect(ask(['github'], 'jira https://acme.atlassian.net').stdout).toBe('tracker\tjira\n');
  });

  it('sends a repository that declared no tracker to its git host', () => {
    // ABSENT IS NOT FALSE, and empty stdin is a COMPLETE answer. A caller
    // reading stdout's emptiness rather than the exit code would read this as
    // a failure and refuse a repository that is configured correctly.
    expect(ask(['github'], '')).toEqual({ code: EXIT.ok, stdout: 'git-host\n' });
  });

  it('treats whitespace-only as no tracker at all', () => {
    expect(ask(['github'], '  \n').stdout).toBe('git-host\n');
  });

  it('refuses a scheme no connector lists, and carries the reason', () => {
    // `linear` is #1131's measured case. The reason travels on the line
    // because `plot-host.sh` prints it as its own exit-4 sentence: a caller
    // reporting only "refused" throws away the half a person acts on.
    const { code, stdout } = ask(['github'], 'linear');
    expect(code).toBe(EXIT.ok);
    expect(stdout.startsWith('nobody\t')).toBe(true);
    expect(stdout).toContain('linear');
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
  });

  it('refuses a lister whose host does not match, naming the host it needs', () => {
    // An entry reading only the scheme would find `github-issues` in the
    // lister list and answer `tracker` on Bitbucket.
    const { stdout } = ask(['bitbucket'], 'github-issues');
    expect(stdout.startsWith('nobody\t')).toBe(true);
    expect(stdout).toContain('github');
    expect(stdout).toContain('bitbucket');
  });

  it('answers `tracker` for the same lister on the host it needs', () => {
    expect(ask(['github'], 'github-issues').stdout).toBe('tracker\tgithub-issues\n');
  });

  it('answers `nobody` with exit 0 — the rule answered', () => {
    // A NON-ZERO EXIT HERE WOULD COLLAPSE TWO ANSWERS. `plot-host.sh` turns
    // `nobody` into its own exit 4 (*this cannot be asked at all*) and an
    // unaskable entry into exit 1 (*the question failed*). If the entry exited
    // non-zero for `nobody`, the shell could not tell them apart and the
    // fall-through this fixes would return through the other door.
    expect(ask(['github'], 'linear').code).toBe(EXIT.ok);
  });

  it('exits 2 when the caller names no git host', () => {
    // The host is half the rule's reading, and a missing one is a broken
    // caller rather than a repository with no tracker.
    expect(run([], 'jira', () => {})).toBe(EXIT.usage);
    expect(run(['  '], 'jira', () => {})).toBe(EXIT.usage);
  });

  it('prints nothing on a usage error', () => {
    const out: string[] = [];
    run([], 'jira', (s) => out.push(s));
    expect(out).toEqual([]);
  });
});
