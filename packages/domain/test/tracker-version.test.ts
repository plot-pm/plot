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

// The version read: one `plot-host.sh version-read` call, then a page loop
// over its issues the same shape as `issueListOpen`'s.

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

const versionLine = (over: Partial<{ name: string; released: boolean; releaseDate: string | null }> = {}): string =>
  JSON.stringify({ name: '1.2.0', released: false, releaseDate: null, ...over });

const row = (n: number): string =>
  JSON.stringify({ number: n, title: `t${n}`, url: 'u', createdAt: 'c', status: 'Done', statusCategory: 'Done' });

const value = (result: PortResult<VersionRead>): VersionRead => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.why}`);
  return result.value;
};

describe('versionRead', () => {
  it('reads the version and its fixVersion issues', async () => {
    const { context, argv } = hostThat(`echo '${versionLine()}'; echo '${row(1)}'; echo '${row(2)}'`);
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read).toEqual({
      name: '1.2.0',
      released: false,
      releaseDate: null,
      issues: [expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' })],
      complete: true,
      pages: 1,
    });
    expect(calls(argv)).toEqual(['version-read 1.2.0 --limit 10']);
  });

  it('answers a released version with its release date', async () => {
    const { context } = hostThat(`echo '${versionLine({ released: true, releaseDate: '2026-10-01' })}'`);
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.released).toBe(true);
    expect(read.releaseDate).toBe('2026-10-01');
  });

  it('answers an empty issue list as answered and complete, not unaskable', async () => {
    const { context } = hostThat(`echo '${versionLine()}'`);
    const read = await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10);
    expect(read).toEqual({
      ok: true,
      value: { name: '1.2.0', released: false, releaseDate: null, issues: [], complete: true, pages: 1 },
    });
  });

  it('keeps an unknown version apart from an empty one', async () => {
    const { context } = hostThat(`echo "plot-host: jira has no version named '9.9.9' in project PROJ" >&2; exit 2`);
    const read = await trackerJira(context, 'https://x.invalid').versionRead('9.9.9', 10);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.why).toBe('unaskable');
  });

  it('keeps a failed read apart from an unknown version', async () => {
    const { context } = hostThat('echo boom >&2; exit 3');
    const read = await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.why).toBe('failed');
  });

  it('answers unaskable with the script reason on exit 4', async () => {
    const { context } = hostThat(`echo "plot-host: version-read needs 'Ticket prefixes' declared" >&2; exit 4`);
    expect(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "version-read needs 'Ticket prefixes' declared",
    });
  });

  it('follows the page token and asks the version only once', async () => {
    const { context, argv } = hostThat(`if [ -z "$(echo "$*" | grep -- --page-token)" ]; then
  echo '${versionLine()}'; echo '${row(1)}'; echo '{"nextPageToken":"p2"}'
else
  echo '${row(2)}'
fi`);
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 10));
    expect(read.issues.map((issue) => issue.id)).toEqual(['1', '2']);
    expect(read.complete).toBe(true);
    expect(calls(argv)).toEqual([
      'version-read 1.2.0 --limit 10',
      'version-read 1.2.0 --limit 9 --page-token p2',
    ]);
  });

  it('stops at the limit and reports the read as incomplete', async () => {
    const { context } = hostThat(`echo '${versionLine()}'; echo '${row(1)}'; echo '${row(2)}'; echo '{"nextPageToken":"p2"}'`);
    const read = value(await trackerJira(context, 'https://x.invalid').versionRead('1.2.0', 2));
    expect(read.issues).toHaveLength(2);
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
    expect(unknown.ok).toBe(false);
    expect(unknown.ok === false && unknown.why).toBe('unaskable');
  });
});
