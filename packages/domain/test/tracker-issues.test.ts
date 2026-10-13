import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { trackerFixture } from '../src/adapters/tracker/tracker-fixture.js';
import { trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import {
  trackerForIssues,
  trackerGitHost,
  trackerOfSource,
} from '../src/adapters/tracker/tracker-resolve.js';
import type { ShellContext } from '../src/adapters/scripts.js';

// The issue reader a repository with no `Tracker` key gets, and the spender
// reading every tracker gives the issue gate (D28).

const roots: string[] = [];

/** A context whose `plot-host.sh` is the given body, recording its argv and PLOT_TRACKER. */
const hostThat = (body: string): { context: ShellContext; argv: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-issues-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const argv = join(root, 'argv');
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(
    file,
    `#!/usr/bin/env bash\nprintf '%s|%s\\n' "\${PLOT_TRACKER:-}" "$*" >> ${JSON.stringify(argv)}\n${body}\n`,
  );
  chmodSync(file, 0o755);
  return { context: { repoRoot: root, scriptDir }, argv };
};

const calls = (argv: string): string[] =>
  existsSync(argv) ? readFileSync(argv, 'utf8').split('\n').filter(Boolean) : [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const SPEND = `if [ "$1" = spend-rate ]; then
  case "$3" in
    github) echo '{"connector":"github","account":"jwloka","perHour":12}' ;;
    jira) echo '{"connector":"jira","account":"jira:0123456789ab","perHour":3}' ;;
    *) echo '{"connector":"'"$3"'","account":"unknown"}' ;;
  esac
  exit 0
fi`;

describe('the spender reading', () => {
  it('names the git host connector and its account for trackerGitHost', async () => {
    const { context, argv } = hostThat(SPEND);
    expect(await trackerGitHost('github', context).spender()).toEqual({
      ok: true,
      value: { connector: 'github', account: 'jwloka' },
    });
    expect(calls(argv)).toEqual(['|spend-rate --connector github']);
  });

  it('names jira and the hashed Jira account for trackerJira', async () => {
    const { context, argv } = hostThat(SPEND);
    expect(await trackerJira(context).spender()).toEqual({
      ok: true,
      value: { connector: 'jira', account: 'jira:0123456789ab' },
    });
    expect(calls(argv)).toEqual(['jira|spend-rate --connector jira']);
  });

  it('names github for trackerGithub', async () => {
    const { context } = hostThat(SPEND);
    expect(await trackerGithub(context).spender()).toEqual({
      ok: true,
      value: { connector: 'github', account: 'jwloka' },
    });
  });

  it('answers a null account where spend-rate fails', async () => {
    const { context } = hostThat('exit 1');
    expect(await trackerGitHost('bitbucket', context).spender()).toEqual({
      ok: true,
      value: { connector: 'bitbucket', account: null },
    });
  });

  it('answers a null account where spend-rate prints no account', async () => {
    const { context } = hostThat('echo \'{"perHour":1}\'');
    expect(await trackerGitHost('github', context).spender()).toEqual({
      ok: true,
      value: { connector: 'github', account: null },
    });
  });

  it('leaves the last refusal of the issue read in place', async () => {
    const { context } = hostThat(`${SPEND}\necho 'API rate limit exceeded' >&2; exit 1`);
    const tracker = trackerGitHost('github', context);
    await tracker.issueList(50);
    await tracker.spender();
    expect(tracker.lastRefusal()).toBe('API rate limit exceeded');
  });

  it('answers unaskable for a repository with no tracker to read', async () => {
    expect(await trackerNone().spender()).toEqual({ ok: false, why: 'unaskable' });
  });

  it('answers the fixture spender, or connector fixture with a null account', async () => {
    expect(await trackerFixture().spender()).toEqual({
      ok: true,
      value: { connector: 'fixture', account: null },
    });
    expect(await trackerFixture({ spender: { connector: 'github', account: 'a' } }).spender()).toEqual({
      ok: true,
      value: { connector: 'github', account: 'a' },
    });
  });
});

describe('trackerGitHost', () => {
  it('reads issues with no PLOT_TRACKER override and passes the limit', async () => {
    const { context, argv } = hostThat('[ "$1" = issue-list ] && echo \'{"number":7,"title":"t","url":"u"}\'; exit 0');
    const listed = await trackerGitHost('github', context).issueList(50);
    expect(listed.ok && listed.value.map((issue) => issue.id)).toEqual(['7']);
    expect(calls(argv)).toEqual(['|issue-list --limit 50']);
  });

  it('views one issue and reads only its own connector\'s limit buckets', async () => {
    const { context } = hostThat(`case "$1" in
  issue-view) echo '{"number":7,"title":"t","url":"u","body":"b"}' ;;
  limit) echo '{"connector":"github","bucket":"core","limit":5000,"remaining":1,"reset":1,"basis":"actual"}'
         echo '{"connector":"jenkins","bucket":"","limit":null,"remaining":null,"reset":null,"basis":"unknown"}' ;;
esac`);
    const tracker = trackerGitHost('github', context);
    const viewed = await tracker.issueView('7');
    expect(viewed.ok && viewed.value.body).toBe('b');
    const limits = await tracker.limit();
    expect(limits.ok && limits.value.map((reading) => reading.connector)).toEqual(['github']);
    expect(tracker.config()).toEqual({ scheme: '', baseUrl: '' });
    expect(tracker.lastRefusal()).toBeNull();
  });

  it('answers unaskable to a status write', async () => {
    const { context, argv } = hostThat('exit 0');
    expect(await trackerGitHost('github', context).statusWrite({ prUrl: 'u', status: 'Done' })).toEqual({
      ok: false,
      why: 'unaskable',
    });
    expect(calls(argv)).toEqual([]);
  });
});

describe('trackerOfSource and trackerForIssues', () => {
  it('resolve a repository with no Tracker key to the git host reader', async () => {
    const { context } = hostThat(SPEND);
    const viaSource = trackerOfSource({ ask: 'git-host' }, '', 'github', context);
    const viaIssues = trackerForIssues('', 'github', context);
    expect((await viaSource.spender()).ok && (await viaIssues.spender())).toEqual({
      ok: true,
      value: { connector: 'github', account: 'jwloka' },
    });
  });

  it('resolve a declared jira tracker to the jira connector', async () => {
    const { context } = hostThat(SPEND);
    expect(trackerOfSource({ ask: 'tracker', scheme: 'jira' }, 'jira https://x.invalid', 'github', context).config())
      .toEqual({ scheme: 'jira', baseUrl: 'https://x.invalid' });
    expect(trackerForIssues('jira https://x.invalid', 'github', context).config().scheme).toBe('jira');
  });

  it('resolve a tracker no connector lists to one that asks nothing', async () => {
    const { context, argv } = hostThat('exit 0');
    expect(await trackerOfSource({ ask: 'nobody', reason: 'r' }, 'linear', 'github', context).issueList())
      .toEqual({ ok: false, why: 'unaskable' });
    expect(await trackerForIssues('linear', 'github', context).issueList())
      .toEqual({ ok: false, why: 'unaskable' });
    expect(calls(argv)).toEqual([]);
  });
});
