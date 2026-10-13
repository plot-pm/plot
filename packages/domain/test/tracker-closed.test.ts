import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import { trackerGitHost } from '../src/adapters/tracker/tracker-resolve.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import type { PortResult } from '../src/port-result.js';
import type { ClosedIssues } from '../src/ports/tracker.js';

// The closed read: a page loop over `plot-host.sh issue-list --state closed`.

const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body, recording one argv line per run. */
const hostThat = (body: string): { context: ShellContext; argv: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-closed-'));
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

const row = (n: number): string =>
  JSON.stringify({ number: n, title: `t${n}`, url: 'u', createdAt: 'c', status: 'Done', statusCategory: 'Done', closedAt: `2026-09-0${n}` });

const SINCE = '2026-09-01T00:00:00Z';

const value = (result: PortResult<ClosedIssues>): ClosedIssues => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.why}`);
  return result.value;
};

describe('issueListClosed', () => {
  it('maps closedAt and reports a read that reached its end as complete', async () => {
    const { context, argv } = hostThat(`echo '${row(1)}'`);
    const closed = value(await trackerGithub(context).issueListClosed(SINCE, 10));
    expect(closed.complete).toBe(true);
    expect(closed.issues.map((issue) => [issue.id, issue.closedAt])).toEqual([['1', '2026-09-01']]);
    expect(calls(argv)).toEqual([`issue-list --state closed --since ${SINCE} --limit 10`]);
  });

  it('follows the page token until none is printed', async () => {
    const { context, argv } = hostThat(`if [ "$*" = "${'issue-list --state closed --since ' + SINCE + ' --limit 5'}" ]; then
  echo '${row(1)}'; echo '{"nextPageToken":"p2"}'
else
  echo '${row(2)}'
fi`);
    const closed = value(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 5));
    expect(closed.issues.map((issue) => issue.id)).toEqual(['2', '1']);
    expect(closed.complete).toBe(true);
    expect(calls(argv)[1]).toBe(`issue-list --state closed --since ${SINCE} --limit 4 --page-token p2`);
  });

  it('stops at the limit and says the read is incomplete', async () => {
    const { context } = hostThat(`echo '${row(1)}'; echo '${row(2)}'; echo '{"nextPageToken":"p2"}'`);
    const closed = value(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 2));
    expect(closed.issues).toHaveLength(2);
    expect(closed.complete).toBe(false);
  });

  it('does not loop on a token it has already followed', async () => {
    const { context, argv } = hostThat(`echo '${row(1)}'; echo '{"nextPageToken":"same"}'`);
    const closed = value(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 50));
    expect(calls(argv)).toHaveLength(2);
    expect(closed.issues).toHaveLength(2);
    expect(closed.complete).toBe(false);
  });

  it('returns rows that arrive out of close order newest close first', async () => {
    // GitHub search ignores a close-date sort (measured 2026-10-13: #1578,
    // closed 15:55, listed before #1571, closed 19:41), so the adapter sorts.
    const closedAt = (n: number, at: string): string =>
      JSON.stringify({ number: n, title: 't', url: 'u', createdAt: 'c', status: 'closed', statusCategory: 'Done', closedAt: at });
    const { context } = hostThat(`if [ -z "$(echo "$*" | grep -- --page-token)" ]; then
  echo '${closedAt(1578, '2026-10-12T15:55:00Z')}'; echo '${closedAt(1, '')}'; echo '{"nextPageToken":"p2"}'
else
  echo '${closedAt(1571, '2026-10-12T19:41:00Z')}'; echo '${closedAt(1600, '2026-10-13T08:00:00Z')}'
fi`);
    const closed = value(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 10));
    expect(closed.issues.map((issue) => issue.id)).toEqual(['1600', '1571', '1578', '1']);
    expect(closed.complete).toBe(true);
  });

  it('answers unaskable without the script prefix in its reason', async () => {
    const { context } = hostThat(`echo "plot-host: bitbucket lists no closing date" >&2; exit 4`);
    expect(await trackerGithub(context).issueListClosed(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'bitbucket lists no closing date',
    });
  });

  it('answers unaskable with the script reason on exit 4', async () => {
    const { context } = hostThat(`echo "closed Jira issues need 'Ticket prefixes' declared" >&2; exit 4`);
    expect(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "closed Jira issues need 'Ticket prefixes' declared",
    });
  });

  it('keeps a failed read apart from an unaskable one', async () => {
    const { context } = hostThat('echo boom >&2; exit 3');
    const result = await trackerGithub(context).issueListClosed(SINCE, 5);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).not.toBe('unaskable');
  });

  it('reads through the git host for trackerGitHost, whose limit stays github-only', async () => {
    const { context, argv } = hostThat(`if [ "$1" = limit ]; then
  echo '{"connector":"github","bucket":"core","remaining":10,"limit":60}'
  echo '{"connector":"jira","bucket":"x","remaining":1,"limit":2}'
  exit 0
fi
echo '${row(1)}'`);
    const tracker = trackerGitHost('github', context);
    expect(value(await tracker.issueListClosed(SINCE, 5)).issues).toHaveLength(1);
    expect(calls(argv)[0]).toContain('--state closed');
    const limits = await tracker.limit();
    expect(limits.ok && limits.value.map((reading) => reading.connector)).toEqual(['github']);
  });

  it('answers unaskable on trackerNone, with the reason it was built with', async () => {
    expect(await trackerNone('plans are the tracker').issueListClosed(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'plans are the tracker',
    });
  });
});

describe('the pages a read spent', () => {
  it('counts one request for an empty answered read', async () => {
    const { context } = hostThat('exit 0');
    expect(value(await trackerGithub(context).issueListClosed(SINCE, 1000)).pages).toBe(1);
  });

  it('counts one request per 100 rows where one gh call paged inside its process', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `echo '${row(i + 1)}'`).join('\n');
    const { context, argv } = hostThat(lines);
    const closed = value(await trackerGithub(context).issueListClosed(SINCE, 1000));
    expect(calls(argv)).toHaveLength(1);
    expect(closed.pages).toBe(2);
  });

  it('counts one request per script call where the script printed a token', async () => {
    const { context } = hostThat(`case "$*" in
  *"--page-token p2"*) exit 0 ;;
  *) echo '${row(1)}'; echo '{"nextPageToken":"p2"}' ;;
esac`);
    expect(value(await trackerJira(context, 'https://x.invalid').issueListClosed(SINCE, 50)).pages).toBe(2);
  });
});

describe('issueListOpen', () => {
  const open = (n: number): string => JSON.stringify({ number: `PROJ-${n}`, title: `t${n}`, url: 'u', createdAt: 'c' });

  it('asks for a paged read and follows the token until none is printed', async () => {
    const { context, argv } = hostThat(`case "$*" in
  *"--page-token p2"*) echo '${open(2)}' ;;
  *) echo '${open(1)}'; echo '{"nextPageToken":"p2"}' ;;
esac`);
    const read = await trackerJira(context, 'https://x.invalid').issueListOpen(1000);
    expect(read).toEqual({
      ok: true,
      value: {
        issues: [expect.objectContaining({ id: 'PROJ-1' }), expect.objectContaining({ id: 'PROJ-2' })],
        complete: true,
        pages: 2,
      },
    });
    expect(calls(argv)).toEqual(['issue-list --paged --limit 1000', 'issue-list --paged --limit 999 --page-token p2']);
  });

  it('keeps the script order, which is the tracker order', async () => {
    const { context } = hostThat(`echo '${open(3)}'; echo '${open(1)}'; echo '${open(2)}'`);
    const read = value(await trackerGithub(context).issueListOpen(1000));
    expect(read.issues.map((issue) => issue.id)).toEqual(['PROJ-3', 'PROJ-1', 'PROJ-2']);
  });

  it('reports a read that stopped at its limit as incomplete', async () => {
    const { context } = hostThat(`echo '${open(1)}'; echo '${open(2)}'; echo '{"nextPageToken":"p2"}'`);
    const read = value(await trackerJira(context, 'https://x.invalid').issueListOpen(2));
    expect(read.issues).toHaveLength(2);
    expect(read.complete).toBe(false);
  });

  it('stops, incomplete, on a token it has already followed', async () => {
    const { context, argv } = hostThat(`echo '${open(1)}'; echo '{"nextPageToken":"same"}'`);
    const read = value(await trackerJira(context, 'https://x.invalid').issueListOpen(1000));
    expect(calls(argv)).toHaveLength(2);
    expect(read.complete).toBe(false);
    expect(read.pages).toBe(2);
  });

  it('fails the whole read where a later page fails', async () => {
    const { context } = hostThat(`case "$*" in
  *"--page-token p2"*) echo 'boom' >&2; exit 3 ;;
  *) echo '${open(1)}'; echo '{"nextPageToken":"p2"}' ;;
esac`);
    const read = await trackerJira(context, 'https://x.invalid').issueListOpen(1000);
    expect(read.ok).toBe(false);
  });

  it('answers unaskable on trackerNone', async () => {
    expect(await trackerNone('plans are the tracker').issueListOpen(5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'plans are the tracker',
    });
  });
});
