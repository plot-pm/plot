import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { trackerFixture } from '../src/adapters/tracker/tracker-fixture.js';
import { githubIssueNumberOf, trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { jiraKeyOf, trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import {
  trackerForIssues,
  trackerGitHost,
  trackerOfSource,
} from '../src/adapters/tracker/tracker-resolve.js';
import { ISSUE_MAY_EXIST, issueOpenOf } from '../src/adapters/tracker/tracker-shell.js';
import type { IssueOpen } from '../src/ports/tracker.js';
import type { ShellContext } from '../src/adapters/scripts.js';

// The issue reader a repository with no `Tracker` key gets, and the spender
// reading every tracker gives the issue gate (D28).

const roots: string[] = [];

/**
 * A context whose `plot-host.sh` is the given body, recording its argv and
 * PLOT_TRACKER, and whose `plot-config.sh` is `config` where one is given.
 */
const hostThat = (body: string, config?: string): { context: ShellContext; argv: string } => {
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
  if (config !== undefined) {
    const configFile = join(scriptDir, 'plot-config.sh');
    writeFileSync(configFile, `#!/usr/bin/env bash\n${config}\n`);
    chmodSync(configFile, 0o755);
  }
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
      reason: "no Tracker declared; the git host's issues are read-only to Plot",
    });
    expect(calls(argv)).toEqual([]);
  });
});

describe('issueOpen on a repository with no Tracker', () => {
  const write = { title: 't', body: 'b', labels: ['ai-generated'] };

  it('answers unaskable through trackerGitHost, with the statusWrite sentence, and calls nothing', async () => {
    const { context, argv } = hostThat('exit 0');
    expect(await trackerGitHost('github', context).issueOpen(write)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "no Tracker declared; the git host's issues are read-only to Plot",
    });
    expect(calls(argv)).toEqual([]);
  });

  it('answers unaskable through trackerNone, with the reason it was built with', async () => {
    expect(await trackerNone('plans are the tracker').issueOpen(write)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: 'plans are the tracker',
    });
  });

  it('resolves every issueSource arm to a tracker that answers issueOpen', async () => {
    const { context } = hostThat('exit 0');
    const viaNobody = trackerOfSource({ ask: 'nobody', reason: 'none declared' }, '', '', context);
    expect(await viaNobody.issueOpen(write)).toEqual({ ok: false, why: 'unaskable', reason: 'none declared' });
    const viaGitHost = trackerOfSource({ ask: 'git-host' }, '', 'github', context);
    expect(await viaGitHost.issueOpen(write)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "no Tracker declared; the git host's issues are read-only to Plot",
    });
  });
});

const OPEN: IssueOpen = { title: 'A claim', body: 'the evidence', labels: ['ai-generated', 'verify'] };

const NOT_HERE = `echo "plot-host: issue-open answers for jira and github-issues only, not 'linear'" >&2; exit 4`;

describe('issueOpen through trackerGithub', () => {
  it('passes the title, the body and one --label per label, and answers the number gh printed', async () => {
    const { context, argv } = hostThat('echo https://github.com/o/r/issues/42');
    const tracker = trackerGithub(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: true, value: { outcome: 'opened', id: '42' } });
    expect(calls(argv)).toEqual(['github-issues|issue-open A claim the evidence --label ai-generated --label verify']);
    expect(tracker.lastRefusal()).toBeNull();
  });

  it('answers unaskable with the stated reason on exit 4', async () => {
    const { context } = hostThat(NOT_HERE);
    const tracker = trackerGithub(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "issue-open answers for jira and github-issues only, not 'linear'",
    });
    expect(tracker.lastRefusal()).toBeNull();
  });

  it('answers failed and records the refusal on any other non-zero exit', async () => {
    const { context } = hostThat("echo 'plot-host: HTTP 502' >&2; exit 3");
    const tracker = trackerGithub(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe('plot-host: HTTP 502');
  });

  it('answers failed where exit 0 names no issue, and says the issue may exist', async () => {
    const { context } = hostThat('exit 0');
    const tracker = trackerGithub(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe(`${ISSUE_MAY_EXIST}the tracker answered with no issue identifier: (nothing)`);
  });

  it('reads the number only from an issue address', () => {
    expect(githubIssueNumberOf('https://github.com/o/r/issues/7\n')).toBe('7');
    expect(githubIssueNumberOf('https://github.com/o/r/pull/7')).toBeNull();
    expect(githubIssueNumberOf('')).toBeNull();
  });
});

/** A `plot-config.sh` declaring two projects and, where given, an issue type. */
const configWith = (issueType?: string): string => `case "$2" in
  'Ticket prefixes') echo 'PROJ, OTHER' ;;
  *) echo ${issueType === undefined ? '"$3"' : JSON.stringify(issueType)} ;;
esac`;

describe('issueOpen through trackerJira', () => {
  /** A host that saves the request it was given and answers `answer`. */
  const jiraHost = (
    answer: string,
    config = configWith(),
  ): { context: ShellContext; argv: string; request: () => unknown } => {
    const root = mkdtempSync(join(tmpdir(), 'plot-tracker-request-'));
    roots.push(root);
    const saved = join(root, 'request.json');
    const { context, argv } = hostThat(`printf '%s' "$2" > ${JSON.stringify(saved)}\n${answer}`, config);
    return { context, argv, request: () => JSON.parse(readFileSync(saved, 'utf8')) };
  };

  it('builds the request in the first declared project as a Task, and answers the key', async () => {
    const { context, argv, request } = jiraHost(`echo '{"id":"1","key":"PROJ-9"}'`);
    const tracker = trackerJira(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: true, value: { outcome: 'opened', id: 'PROJ-9' } });
    expect(request()).toEqual({
      fields: {
        project: { key: 'PROJ' },
        issuetype: { name: 'Task' },
        summary: 'A claim',
        description: 'the evidence',
        labels: ['ai-generated', 'verify'],
      },
    });
    expect(calls(argv)).toHaveLength(1);
    expect(calls(argv)[0]).toMatch(/^jira\|issue-open \{/);
    expect(tracker.lastRefusal()).toBeNull();
  });

  it('opens the issue type the Tracker issue type key names', async () => {
    const { context, request } = jiraHost(`echo '{"key":"PROJ-10"}'`, configWith('Bug'));
    expect(await trackerJira(context).issueOpen(OPEN)).toEqual({ ok: true, value: { outcome: 'opened', id: 'PROJ-10' } });
    expect(request()).toMatchObject({ fields: { issuetype: { name: 'Bug' } } });
  });

  it('answers unaskable with the stated reason on exit 4', async () => {
    const { context } = jiraHost(NOT_HERE);
    expect(await trackerJira(context).issueOpen(OPEN)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "issue-open answers for jira and github-issues only, not 'linear'",
    });
  });

  it('answers failed and records the refusal on any other non-zero exit', async () => {
    const { context } = jiraHost("echo 'plot-host: jira HTTP 400 — issuetype is invalid' >&2; exit 3");
    const tracker = trackerJira(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe('plot-host: jira HTTP 400 — issuetype is invalid');
  });

  it('answers failed where Jira answered 2xx with no key, and says the issue may exist', async () => {
    const { context } = jiraHost(`echo '{"id":"1"}'`);
    const tracker = trackerJira(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe(`${ISSUE_MAY_EXIST}the tracker answered with no issue identifier: {"id":"1"}`);
  });

  it('answers unaskable and calls no host where no Ticket prefixes are declared', async () => {
    const { context, argv } = hostThat('exit 0', 'echo "${3:-}"');
    expect(await trackerJira(context).issueOpen(OPEN)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "opening a Jira issue needs 'Ticket prefixes' declared",
    });
    expect(calls(argv)).toEqual([]);
  });

  it('answers failed and calls no host where the config cannot be read', async () => {
    const { context, argv } = hostThat('exit 0', "echo 'plot-config: no CLAUDE.md' >&2; exit 2");
    const tracker = trackerJira(context);
    expect(await tracker.issueOpen(OPEN)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe('plot-config: no CLAUDE.md');
    expect(calls(argv)).toEqual([]);
  });

  it('reads a key only from a JSON answer that names one', () => {
    expect(jiraKeyOf('{"key":"PROJ-1"}')).toBe('PROJ-1');
    expect(jiraKeyOf('{"key":""}')).toBeNull();
    expect(jiraKeyOf('null')).toBeNull();
    expect(jiraKeyOf('not json')).toBeNull();
  });
});

describe('issueListInbox through trackerJira (D23)', () => {
  it('answers unaskable and calls no host where no Ticket prefixes are declared', async () => {
    const { context, argv } = hostThat('exit 0', 'echo "${3:-}"');
    expect(await trackerJira(context).issueListInbox(50)).toEqual({
      ok: false,
      why: 'unaskable',
      reason: "the Jira inbox read needs 'Ticket prefixes' declared; with none, the open read is already person-scoped",
    });
    expect(calls(argv)).toEqual([]);
  });

  it('answers failed and calls no issue-list where the config cannot be read', async () => {
    const { context, argv } = hostThat('exit 0', "echo 'plot-config: no CLAUDE.md' >&2; exit 2");
    const tracker = trackerJira(context);
    expect(await tracker.issueListInbox(50)).toEqual({ ok: false, why: 'failed' });
    expect(tracker.lastRefusal()).toBe('plot-config: no CLAUDE.md');
    expect(calls(argv)).toEqual([]);
  });

  it('delegates to the host once Ticket prefixes is declared', async () => {
    const { context, argv } = hostThat(
      `if [ "$1" = issue-list ]; then echo '{"number":"PROJ-1","title":"mine","url":"u1"}'; fi`,
      configWith(),
    );
    expect(await trackerJira(context).issueListInbox(50)).toEqual({
      ok: true,
      value: { issues: [expect.objectContaining({ id: 'PROJ-1', title: 'mine' })], pages: 1, complete: true },
    });
    expect(calls(argv).some((call) => call.includes('issue-list --state inbox'))).toBe(true);
  });
});

describe('issueOpenOf', () => {
  it('says the issue may exist where the run ended at its time bound', () => {
    const refusals: (string | null)[] = [];
    const said = { code: 1, stdout: '', stderr: '', interrupted: 'timeout' as const };
    expect(issueOpenOf(said, () => '1', (r) => refusals.push(r))).toEqual({ ok: false, why: 'failed' });
    expect(refusals).toEqual([
      `${ISSUE_MAY_EXIST}plot-host.sh issue-open ended by timeout after the request may have been sent`,
    ]);
  });

  it('names the exit code where a failed run printed nothing', () => {
    const refusals: (string | null)[] = [];
    expect(issueOpenOf({ code: 2, stdout: '', stderr: '' }, () => '1', (r) => refusals.push(r))).toEqual({
      ok: false,
      why: 'failed',
    });
    expect(refusals).toEqual(['plot-host.sh exited 2']);
  });
});

describe('issueOpen through the fixture', () => {
  it('records every write before it refuses, and numbers the ones it opens', async () => {
    const opened: IssueOpen[] = [];
    expect(await trackerFixture({ opened }).issueOpen(OPEN)).toEqual({
      ok: true,
      value: { outcome: 'opened', id: '1' },
    });
    expect(await trackerFixture({ opened, issueOpenFails: true }).issueOpen(OPEN)).toEqual({
      ok: false,
      why: 'failed',
    });
    expect(opened).toEqual([OPEN, OPEN]);
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
      .toEqual({ ok: false, why: 'unaskable', reason: 'r' });
    expect(await trackerForIssues('linear', 'github', context).issueList())
      .toMatchObject({ ok: false, why: 'unaskable', reason: expect.any(String) });
    expect(calls(argv)).toEqual([]);
  });
});
