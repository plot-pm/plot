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
import type { Issue } from '../src/entities/issue.js';
import type { PortResult } from '../src/port-result.js';
import type { IssueRead } from '../src/ports/tracker.js';

// The changed read: a page loop over `plot-host.sh issue-list --state changed`.

const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body, recording one argv line per run. */
const hostThat = (body: string): { context: ShellContext; argv: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-changed-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const argv = join(root, 'argv');
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(argv)}\n${body}\n`);
  chmodSync(file, 0o755);
  return { context: { repoRoot: root, scriptDir }, argv };
};

/** A context whose `plot-host.sh ticket-projects` answers the given lines, and whose `issue-list` is the given body. */
const hostWithProjects = (projects: string[], body: string): { context: ShellContext; argv: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-changed-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const argv = join(root, 'argv');
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(
    file,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(argv)}\nif [ "$1" = ticket-projects ]; then\n${
      projects.length === 0 ? '' : projects.map((p) => `  echo '${p}'\n`).join('')
    }  exit 0\nfi\n${body}\n`,
  );
  chmodSync(file, 0o755);
  return { context: { repoRoot: root, scriptDir }, argv };
};

const calls = (argv: string): string[] =>
  existsSync(argv) ? readFileSync(argv, 'utf8').split('\n').filter(Boolean) : [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const row = (n: number, overrides: Partial<Record<string, unknown>> = {}): string =>
  JSON.stringify({ number: n, title: `t${n}`, url: 'u', createdAt: 'c', updatedAt: `2026-09-0${n}T00:00:00Z`, ...overrides });

const SINCE = '2026-09-01T00:00:00Z';

const value = (result: PortResult<IssueRead>): IssueRead => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.why}`);
  return result.value;
};

describe('issueListChanged', () => {
  it('maps updatedAt and reports a read that reached its end as complete', async () => {
    const { context, argv } = hostThat(`echo '${row(1)}'`);
    const changed = value(await trackerGithub(context).issueListChanged(SINCE, 10));
    expect(changed.complete).toBe(true);
    expect(changed.issues.map((issue) => [issue.id, issue.updatedAt])).toEqual([['1', '2026-09-01T00:00:00Z']]);
    expect(calls(argv)).toEqual([`issue-list --state changed --since ${SINCE} --limit 10`]);
  });

  it('follows the page token until none is printed', async () => {
    const { context, argv } = hostWithProjects(
      ['PROJ'],
      `case "$*" in
  *"--page-token p2"*) echo '${row(2)}' ;;
  *) echo '${row(1)}'; echo '{"nextPageToken":"p2"}' ;;
esac`,
    );
    const changed = value(await trackerJira(context, 'https://x.invalid').issueListChanged(SINCE, 5));
    expect(changed.issues.map((issue) => issue.id)).toEqual(['1', '2']);
    expect(changed.complete).toBe(true);
    expect(calls(argv).filter((line) => line.includes('--state changed'))[1]).toBe(
      `issue-list --state changed --since ${SINCE} --limit 4 --page-token p2`,
    );
  });

  it('stops at the limit and says the read is incomplete', async () => {
    const { context } = hostThat(`echo '${row(1)}'; echo '${row(2)}'; echo '{"nextPageToken":"p2"}'`);
    const changed = value(await trackerGithub(context).issueListChanged(SINCE, 2));
    expect(changed.issues).toHaveLength(2);
    expect(changed.complete).toBe(false);
  });

  it('answers unaskable without the script prefix in its reason', async () => {
    const { context } = hostThat(`echo "plot-host: bitbucket lists no changed-since filter" >&2; exit 4`);
    expect(await trackerGithub(context).issueListChanged(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'bitbucket lists no changed-since filter',
    });
  });

  it('keeps a failed read apart from an unaskable one', async () => {
    const { context } = hostThat('echo boom >&2; exit 3');
    const result = await trackerGithub(context).issueListChanged(SINCE, 5);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).not.toBe('unaskable');
  });

  it("answers unaskable on Jira with no 'Ticket prefixes' declared", async () => {
    const { context, argv } = hostWithProjects([], `echo '${row(1)}'`);
    expect(await trackerJira(context, 'https://x.invalid').issueListChanged(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "a Jira changed-issue read needs 'Ticket prefixes' declared",
    });
    expect(calls(argv).some((line) => line.includes('--state changed'))).toBe(false);
  });

  it('fails on Jira where the ticket-projects read itself fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-tracker-changed-'));
    roots.push(root);
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir);
    const file = join(scriptDir, 'plot-host.sh');
    writeFileSync(file, `#!/usr/bin/env bash\nif [ "$1" = ticket-projects ]; then\n  echo boom >&2\n  exit 3\nfi\necho '${row(1)}'\n`);
    chmodSync(file, 0o755);
    const result = await trackerJira({ repoRoot: root, scriptDir }, 'https://x.invalid').issueListChanged(SINCE, 5);
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
    expect(value(await tracker.issueListChanged(SINCE, 5)).issues).toHaveLength(1);
    expect(calls(argv)[0]).toContain('--state changed');
    const limits = await tracker.limit();
    expect(limits.ok && limits.value.map((reading) => reading.connector)).toEqual(['github']);
  });

  it('answers unaskable on trackerNone, with the reason it was built with', async () => {
    expect(await trackerNone('plans are the tracker').issueListChanged(SINCE, 5)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'plans are the tracker',
    });
  });

  it('on trackerFixture, answers every issue whose updatedAt is at or after since, in fixture order', async () => {
    const issues: Issue[] = [
      { id: '1', title: 't1', url: '', createdAt: null, body: null, status: '', statusCategory: '', closedAt: null, assignees: [], updatedAt: '2026-08-31T00:00:00Z' },
      { id: '2', title: 't2', url: '', createdAt: null, body: null, status: '', statusCategory: '', closedAt: null, assignees: [], updatedAt: '2026-09-02T00:00:00Z' },
      { id: '3', title: 't3', url: '', createdAt: null, body: null, status: '', statusCategory: 'Done', closedAt: '2026-09-02', assignees: [] },
    ];
    const tracker = trackerFixture({ issues });
    const changed = value(await tracker.issueListChanged(SINCE, 10));
    expect(changed.issues.map((issue) => issue.id)).toEqual(['2']);
    expect(changed.complete).toBe(true);
  });
});

describe('the pages a read spent', () => {
  it('counts one request for an empty answered read', async () => {
    const { context } = hostThat('exit 0');
    expect(value(await trackerGithub(context).issueListChanged(SINCE, 1000)).pages).toBe(1);
  });

  it('counts one request per 100 rows where one gh call paged inside its process', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `echo '${row((i % 9) + 1)}'`).join('\n');
    const { context, argv } = hostThat(lines);
    const changed = value(await trackerGithub(context).issueListChanged(SINCE, 1000));
    expect(calls(argv)).toHaveLength(1);
    expect(changed.pages).toBe(2);
  });

  it('counts one request per script call where the script printed a token', async () => {
    const { context } = hostThat(`case "$*" in
  *"--page-token p2"*) exit 0 ;;
  *) echo '${row(1)}'; echo '{"nextPageToken":"p2"}' ;;
esac`);
    expect(value(await trackerGithub(context).issueListChanged(SINCE, 50)).pages).toBe(2);
  });
});
