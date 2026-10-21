import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { trackerFixture } from '../src/adapters/tracker/tracker-fixture.js';
import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import { trackerGitHost } from '../src/adapters/tracker/tracker-resolve.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import type { PortResult } from '../src/port-result.js';
import type { VersionRead } from '../src/ports/tracker.js';

// The version read: `ticket-projects`, one `version-list` per project, then
// a page loop over `issue-list --fix-version` the same shape as `issueListOpen`'s.

const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body, recording one argv line per run. */
const hostThat = (body: string): { context: ShellContext; argv: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-version-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const argv = join(root, 'argv');
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(argv)}\n${body}\n`);
  chmodSync(file, 0o755);
  return { context: { repoRoot: root, scriptDir }, argv };
};

const calls = (argv: string): string[] =>
  existsSync(argv) ? readFileSync(argv, 'utf8').split('\n').filter(Boolean) : [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const version = (over: Partial<{ name: string; released: boolean; releaseDate: string | null }> = {}): string =>
  JSON.stringify({ name: '1.2.0', released: false, releaseDate: null, ...over });

const row = (n: number | string): string =>
  JSON.stringify({ number: n, title: `t${n}`, url: 'u', createdAt: 'c', status: 'Done', statusCategory: 'Done' });

const value = (result: PortResult<VersionRead>): VersionRead => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.why}`);
  return result.value;
};

/**
 * A `plot-host.sh` body answering the three ops the Jira read calls.
 *
 * @param projects - what `ticket-projects` prints, one key per line.
 * @param versions - what `version-list <project>` prints, per project.
 * @param issues - the body of the `issue-list --fix-version` arm.
 */
const jiraHost = (projects: string[], versions: Record<string, string[]>, issues: string): string => `case "$1" in
  ticket-projects) printf '%s\\n' ${projects.map((key) => `'${key}'`).join(' ')} ;;
  version-list) case "$2" in
${Object.entries(versions)
  .map(([key, lines]) => `    ${key}) ${lines.map((line) => `echo '${line}'`).join('; ') || ':'} ;;`)
  .join('\n')}
    *) echo "plot-host: jira HTTP 404" >&2; exit 3 ;;
  esac ;;
  issue-list) ${issues} ;;
esac`;

describe('versionRead', () => {
  it('reads the version and its fixVersion issues', async () => {
    const { context, argv } = hostThat(jiraHost(['PROJ'], { PROJ: [version({ name: '1.1.0' }), version()] }, `echo '${row(1)}'; echo '${row(2)}'`));
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read).toEqual({
      name: '1.2.0',
      released: false,
      releaseDate: null,
      issues: [expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' })],
      complete: true,
      pages: 2,
    });
    expect(calls(argv)).toEqual(['ticket-projects', 'version-list PROJ', 'issue-list --fix-version 1.2.0 --limit 10']);
  });

  it('answers a released version with its release date', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version({ released: true, releaseDate: '2026-10-01' })] }, ':'));
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.released).toBe(true);
    expect(read.releaseDate).toBe('2026-10-01');
  });

  it('answers an empty issue list as answered and complete, not unaskable', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version()] }, ':'));
    const read = await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10);
    expect(read).toEqual({
      ok: true,
      value: { name: '1.2.0', released: false, releaseDate: null, issues: [], complete: true, pages: 2 },
    });
  });

  it('keeps an unknown version apart from an empty one, with the version-not-found reason', async () => {
    const { context, argv } = hostThat(jiraHost(['PROJ', 'OTHER'], { PROJ: [version({ name: '1.1.0' })], OTHER: [] }, 'exit 1'));
    expect(await trackerJira(context, 'https://x.invalid').versionRead('9.9.9', 10)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "version-not-found: jira has no version named '9.9.9' in PROJ, OTHER",
    });
    expect(calls(argv)).not.toContain('issue-list --fix-version 9.9.9 --limit 10');
  });

  it('finds a version that only the second project holds', async () => {
    const { context } = hostThat(jiraHost(['PROJ', 'OTHER'], { PROJ: [], OTHER: [version({ released: true })] }, `echo '${row('OTHER-1')}'`));
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.released).toBe(true);
    expect(read.issues.map((issue) => issue.id)).toEqual(['OTHER-1']);
    expect(read.pages).toBe(3);
  });

  it('folds same-named versions of the searched projects: released only where every copy is', async () => {
    const { context } = hostThat(
      jiraHost(
        ['PROJ', 'OTHER'],
        { PROJ: [version({ released: true, releaseDate: '2026-10-01' })], OTHER: [version({ released: false, releaseDate: '2026-10-15' })] },
        ':',
      ),
    );
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.released).toBe(false);
    expect(read.releaseDate).toBe('2026-10-15');
  });

  it('answers failed when a project version list fails, never not-found', async () => {
    const { context } = hostThat(jiraHost(['PROJ', 'GONE'], { PROJ: [] }, ':'));
    const tracker = trackerJira(context, 'https://x.invalid');
    const read = await tracker.versionRead('1.2.0', 10);
    expect(read).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toContain('404');
  });

  it('answers failed, not a rejected promise, when a version line does not parse', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: ['not json'] }, ':'));
    await expect(trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10)).resolves.toEqual({ ok: false, why: 'failed' });
  });

  it('answers failed, not a rejected promise, when an issue line does not parse', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version()] }, "echo 'not json'"));
    await expect(trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10)).resolves.toEqual({ ok: false, why: 'failed' });
  });

  it('keeps a failed issue read apart from an unknown version', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version()] }, 'echo boom >&2; exit 3'));
    const read = await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10);
    expect(read).toEqual({ ok: false, why: 'failed' });
  });

  it('answers unaskable with no Ticket prefixes declared, and asks no version list', async () => {
    const { context, argv } = hostThat(jiraHost([], {}, ':'));
    expect(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "a Jira version read needs 'Ticket prefixes' declared",
    });
    expect(calls(argv)).toEqual(['ticket-projects']);
  });

  it('answers unaskable with the script reason on exit 4', async () => {
    const { context } = hostThat(`[ "$1" = ticket-projects ] && { echo PROJ; exit 0; }; echo "plot-host: version-list needs 'Tracker: jira'" >&2; exit 4`);
    expect(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "version-list needs 'Tracker: jira'",
    });
  });

  it('follows the page token and asks the versions only once', async () => {
    const { context, argv } = hostThat(
      jiraHost(['PROJ'], { PROJ: [version()] }, `if [ -z "$(echo "$*" | grep -- --page-token)" ]; then echo '${row(1)}'; echo '{"nextPageToken":"p2"}'; else echo '${row(2)}'; fi`),
    );
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.issues.map((issue) => issue.id)).toEqual(['1', '2']);
    expect(read.complete).toBe(true);
    expect(read.pages).toBe(3);
    expect(calls(argv)).toEqual([
      'ticket-projects',
      'version-list PROJ',
      'issue-list --fix-version 1.2.0 --limit 10',
      'issue-list --fix-version 1.2.0 --limit 9 --page-token p2',
    ]);
  });

  it('stops at the limit and reports the read as incomplete', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version()] }, `echo '${row(1)}'; echo '${row(2)}'; echo '{"nextPageToken":"p2"}'`));
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 2));
    expect(read.issues).toHaveLength(2);
    expect(read.complete).toBe(false);
  });

  it('answers a limit of 0 as an incomplete read of the found version, not a bare failure', async () => {
    const { context } = hostThat(jiraHost(['PROJ'], { PROJ: [version()] }, `echo '${row(1)}'`));
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 0));
    expect(read.issues).toEqual([]);
    expect(read.complete).toBe(false);
  });

  it('answers unaskable on trackerNone', async () => {
    expect(await trackerNone('plans are the tracker').versionRead('1.2.0', 10)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'plans are the tracker',
    });
  });

  it('answers unaskable on trackerGithub, which has no version concept', async () => {
    const { context } = hostThat('echo should-not-run; exit 1');
    const read = await trackerGithub(context).versionRead('1.2.0', 10);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.why).toBe('unaskable');
  });

  it('answers unaskable on trackerGitHost, which has no version concept', async () => {
    const { context } = hostThat('echo should-not-run; exit 1');
    const read = await trackerGitHost('github', context).versionRead('1.2.0', 10);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.why).toBe('unaskable');
  });

  it('answers from values on the fixture, keeping empty apart from unknown', async () => {
    const found = await trackerFixture({
      versions: { '1.2.0': { name: '1.2.0', released: true, releaseDate: '2026-10-01' } },
      labelled: { 'fixVersion:1.2.0': [{ id: '1', title: 't', url: 'u', createdAt: null, body: null, status: '', statusCategory: '', closedAt: null, assignees: [] }] },
    }).versionRead('1.2.0', 10);
    expect(value(found).issues).toHaveLength(1);
    expect(value(found).released).toBe(true);

    const unknown = await trackerFixture({ versions: {} }).versionRead('9.9.9', 10);
    expect(unknown).toEqual({ ok: false, why: 'unaskable', reason: "version-not-found: this fixture has no version named '9.9.9'" });
  });
});
