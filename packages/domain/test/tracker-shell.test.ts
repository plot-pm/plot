import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { boardOf, trackerGithub } from '../src/adapters/tracker/tracker-github.js';
import { keyIn, trackerJira } from '../src/adapters/tracker/tracker-jira.js';
import { trackerNone } from '../src/adapters/tracker/tracker-none.js';
import { trackerFor } from '../src/adapters/tracker/tracker-resolve.js';
import { trackerFixture } from '../src/adapters/tracker/tracker-fixture.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import type { StatusOutcome, StatusWrite, Tracker } from '../src/ports/tracker.js';
import type { Issue } from '../src/entities/issue.js';
import type { LimitReading } from '../src/entities/limit.js';

/**
 * A MOCKED TRACKER FAILS ON DEMAND.
 *
 * What is faked here is the far side of the scripts, and nothing else. Each
 * case writes real `plot-*.sh` files into a real directory and lets a real
 * connector spawn them: the connector, `runProcess`, `execFile`, the pipe and
 * the exit code are all production's. Only the service beyond the script — a
 * tracker under a rate limit, a project board nobody configured — is replaced.
 *
 * The exit codes below are the ones `plot-host.sh` documents: 0 answered, 3 the
 * question failed, 4 this connector cannot be asked at all.
 */

const roots: string[] = [];

/** Builds a context whose scripts are the given bodies, by filename. */
const scriptsThat = (bodies: Readonly<Record<string, string>>): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-tracker-mock-'));
  roots.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  for (const [name, body] of Object.entries(bodies)) {
    const file = join(scriptDir, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/**
 * Reads an answered result, failing the test where the call did not answer.
 *
 * Narrowed by `isAnswered` rather than cast: a cast would compile against a
 * refusal, which is the one thing every test here is trying to tell apart from
 * an answer.
 */
const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

describe('a tracker is asked apart from the git host', () => {
  it('drives one scheme whatever the repository declared', async () => {
    // THE CONNECTOR TELLS THE SCRIPT WHICH ARM TO ANSWER AS. A script left to
    // resolve the scheme itself would let this connector answer with another
    // tracker's issues the moment somebody edited a config key — the branch
    // this port exists to remove.
    const context = scriptsThat({
      'plot-host.sh': 'printf "%s\\n" "$PLOT_TRACKER" >&2; exit 1',
    });
    await trackerJira(context).issueList();
    // The refusal carries what the script said, which is the scheme it was told.
    expect(trackerJira(context).config().scheme).toBe('jira');

    const seen = scriptsThat({
      'plot-host.sh': '[ "$PLOT_TRACKER" = jira ] || exit 1; echo \'{"number":"PROJ-1"}\'',
    });
    const issues = answer<readonly Issue[]>(await trackerJira(seen).issueList());
    expect(issues.map((issue) => issue.id)).toEqual(['PROJ-1']);
  });

  it('keeps an identifier a string, whichever tracker answered', async () => {
    // One tracker yields a number and another a key, and only one of them is a
    // number by accident of the vendor — so neither arrives in the domain as
    // one. Comparing them as numbers makes a filter silently always-false.
    const numbered = scriptsThat({
      'plot-host.sh':
        'echo \'{"number":12,"title":"A bug","url":"u","createdAt":"2026-09-06","body":"B"}\'',
    });
    expect(answer<Issue>(await trackerGithub(numbered).issueView('12'))).toEqual({
      id: '12',
      title: 'A bug',
      url: 'u',
      createdAt: '2026-09-06',
      body: 'B',
    });

    const keyed = scriptsThat({
      'plot-host.sh': 'echo \'{"number":"PLOT-7","title":"A story"}\'',
    });
    expect(answer<Issue>(await trackerJira(keyed).issueView('PLOT-7'))).toMatchObject({
      id: 'PLOT-7',
      title: 'A story',
    });
  });

  it('leaves an unfetched body null and an empty one empty', async () => {
    // The list omits bodies deliberately — it is asked on a timer for every
    // open issue. So null means NOT FETCHED, and a caller deciding *is this
    // worth a plan?* must not read it as an empty problem statement.
    const bare = scriptsThat({ 'plot-host.sh': "echo '{}'" });
    expect(answer<readonly Issue[]>(await trackerGithub(bare).issueList())).toEqual([
      { id: '', title: '', url: '', createdAt: null, body: null },
    ]);

    const empty = scriptsThat({
      'plot-host.sh': 'echo \'{"number":4,"createdAt":"","body":""}\'',
    });
    expect(answer<readonly Issue[]>(await trackerGithub(empty).issueList())).toMatchObject([
      { createdAt: null, body: '' },
    ]);
  });

  it('keeps a broken lookup apart from a connector that cannot be asked', async () => {
    // The `unaskable` this port keeps is the one it really names. Exit 3 is a
    // question that failed and is worth retrying; exit 4 is a standing fact,
    // and a caller told to retry it retries forever.
    const broke = scriptsThat({ 'plot-host.sh': 'exit 3' });
    const cannot = scriptsThat({ 'plot-host.sh': 'exit 4' });
    expect(await trackerGithub(broke).issueList()).toEqual({ ok: false, why: 'failed' });
    expect(await trackerGithub(cannot).issueList()).toEqual({ ok: false, why: 'unaskable' });
    expect(await trackerGithub(broke).issueView('7')).not.toEqual(
      await trackerGithub(cannot).issueView('7'),
    );
  });

  it('tells an empty inbox apart from both refusals', async () => {
    // An empty list means the tracker answered and holds none. Collapsing it
    // into either refusal is a board saying *you have no tickets* about a
    // question it could not put.
    const none = scriptsThat({ 'plot-host.sh': 'exit 0' });
    const empty = await trackerGithub(none).issueList();
    expect(empty).toEqual({ ok: true, value: [] });
    expect(empty).not.toEqual(await trackerGithub(scriptsThat({ 'plot-host.sh': 'exit 3' })).issueList());
    expect(empty).not.toEqual(await trackerGithub(scriptsThat({ 'plot-host.sh': 'exit 4' })).issueList());
  });

  it('reports a refusal for a failure and none for a standing absence', async () => {
    // Exit 4 is not a refusal. A connector that cannot be asked is answering,
    // permanently and correctly; recording it as a refusal makes a
    // configuration fact look like an incident worth waiting out.
    const broke = trackerGithub(scriptsThat({ 'plot-host.sh': 'echo "boom" >&2; exit 3' }));
    await broke.issueList();
    expect(broke.lastRefusal()).toBe('boom');

    const cannot = trackerGithub(scriptsThat({ 'plot-host.sh': 'exit 4' }));
    await cannot.issueList();
    expect(cannot.lastRefusal()).toBeNull();
  });

  it('passes a limit through, and omits it when unset', async () => {
    // A limit that silently fails to reach the script is how a truncated page
    // reads as a complete one.
    const withLimit = scriptsThat({
      'plot-host.sh': '[ "$*" = "issue-list --limit 10" ] || exit 1; exit 0',
    });
    expect(await trackerGithub(withLimit).issueList(10)).toEqual({ ok: true, value: [] });
    const without = scriptsThat({
      'plot-host.sh': '[ "$*" = "issue-list" ] || exit 1; exit 0',
    });
    expect(await trackerGithub(without).issueList()).toEqual({ ok: true, value: [] });
  });
});

describe('each connector owns its own budget', () => {
  /** Both connectors' readings on one script, as `plot-host.sh limit` prints them. */
  const metering = () =>
    scriptsThat({
      'plot-host.sh': [
        `echo '{"connector":"github","bucket":"core","limit":5000,"remaining":4000,"reset":1756512000,"basis":"actual"}'`,
        `echo '{"connector":"jira","bucket":"api","limit":null,"remaining":null,"reset":null,"basis":"unknown"}'`,
      ].join('\n'),
    });

  it('reports this connector’s buckets and never the other’s', async () => {
    // TWO TRACKERS REACHED FROM ONE REPOSITORY HAVE TWO ACCOUNTS AND TWO
    // WINDOWS. A caller reading one connector's headroom to pace calls against
    // the other spends a budget it never measured — which is the whole reason
    // the port carries `limit` per connector rather than borrowing the git
    // host's.
    const github = answer<readonly LimitReading[]>(await trackerGithub(metering()).limit());
    expect(github.map((reading) => reading.connector)).toEqual(['github']);

    const jira = answer<readonly LimitReading[]>(await trackerJira(metering()).limit());
    expect(jira.map((reading) => reading.connector)).toEqual(['jira']);
  });

  it('answers an empty list where this connector meters nothing', async () => {
    // An empty list is an ANSWER — this connector meters nothing. It is not
    // `free`: a caller reads the basis, and there is no reading to read.
    const only = scriptsThat({
      'plot-host.sh':
        'printf \'%s\\n\' \'{"connector":"github","bucket":"core","limit":1,"remaining":1,"reset":1,"basis":"actual"}\'',
    });
    expect(await trackerJira(only).limit()).toEqual({ ok: true, value: [] });
  });
});

describe('a status reaches the tracker it was told about', () => {
  it('transitions the issue a pull request names', async () => {
    // ASSERTED: A JIRA PROJECT'S STATUS UPDATES REACH JIRA. The connector is
    // handed a PR and a status; it resolves the issue and the script performs
    // the one write this port allows.
    const log = join(mkdtempSync(join(tmpdir(), 'plot-tracker-log-')), 'written');
    roots.push(log);
    const context = scriptsThat({
      'plot-host.sh': `
        [ "$1" = issue-status ] || exit 1
        printf '%s %s\\n' "$2" "$3" > "${log}"
        echo written
      `,
    });
    const result = await trackerJira(context).statusWrite({
      prUrl: 'https://git.invalid/plot/pull/9/PROJ-42-add-a-thing',
      status: 'In Progress',
    });
    expect(answer<StatusOutcome>(result)).toBe('written');
    expect((await import('node:fs')).readFileSync(log, 'utf8').trim()).toBe('PROJ-42 In Progress');
  });

  it('reads the script’s word rather than its exit code', async () => {
    // `no-target` and `written` are both clean exits. Collapsing them reports a
    // status the workflow refused as one it recorded — and a repeated write,
    // which the tracker answers by offering no such transition, would read as
    // having moved the ticket a second time.
    const refused = scriptsThat({ 'plot-host.sh': 'echo no-target' });
    const result = await trackerJira(refused).statusWrite({
      prUrl: 'PROJ-1',
      status: 'Done',
    });
    expect(answer<StatusOutcome>(result)).toBe('no-target');
  });

  it('answers no-target for a pull request naming no issue, never a failure', async () => {
    // A pull request that names no issue is the ordinary case for work nobody
    // ticketed. The tracker was reachable; there was simply nothing to write
    // against, and no call is made at all.
    const never = scriptsThat({ 'plot-host.sh': 'exit 1' });
    const result = await trackerJira(never).statusWrite({
      prUrl: 'https://git.invalid/plot/pull/9',
      status: 'Done',
    });
    expect(answer<StatusOutcome>(result)).toBe('no-target');
  });

  it('writes through this vendor’s own projects surface', async () => {
    // The two connectors write through DIFFERENT APIs under DIFFERENT
    // credentials, which is why the port has two rather than one arm with a
    // branch. This one's write never reaches `plot-host.sh` at all.
    const log = join(mkdtempSync(join(tmpdir(), 'plot-board-log-')), 'written');
    roots.push(log);
    const context = scriptsThat({
      'plot-host.sh': 'exit 1',
      'plot-config.sh': 'echo acme/7',
      'plot-update-board.sh': `printf '%s\\n' "$*" > "${log}"`,
    });
    const result = await trackerGithub(context).statusWrite({
      prUrl: 'https://git.invalid/pr/3',
      status: 'Done',
    });
    expect(answer<StatusOutcome>(result)).toBe('written');
    expect((await import('node:fs')).readFileSync(log, 'utf8').trim()).toBe(
      'https://git.invalid/pr/3 Done acme 7',
    );
  });

  it('reads a graceful skip as no-target rather than as a write', async () => {
    // `plot-update-board.sh` exits 0 on a skip: a missing token scope, a
    // project it could not resolve, a status option that does not exist. A
    // connector reading only the exit code reports every one of them as
    // `written`.
    const context = scriptsThat({
      'plot-config.sh': 'echo acme/7',
      'plot-update-board.sh': 'echo "Warning: Could not resolve project acme/7" >&2; exit 0',
    });
    const tracker = trackerGithub(context);
    expect(answer<StatusOutcome>(await tracker.statusWrite({ prUrl: 'u', status: 'Done' }))).toBe(
      'no-target',
    );
    expect(tracker.lastRefusal()).toContain('Could not resolve project');
  });

  it('answers no-target where the repository named no board', async () => {
    // A DECLARED TRACKER WITH NOWHERE TO PUT A STATUS IS NOT AN UNDECLARED ONE.
    // This repository reached its tracker; it simply named no board. Reporting
    // that as a success claims a write that never happened.
    const context = scriptsThat({
      'plot-config.sh': 'echo ""',
      'plot-update-board.sh': 'exit 1',
    });
    expect(
      answer<StatusOutcome>(await trackerGithub(context).statusWrite({ prUrl: 'u', status: 'Done' })),
    ).toBe('no-target');
  });

  it('reads a board key only in the shape it was promised', () => {
    expect(boardOf('acme/7')).toEqual({ owner: 'acme', number: '7' });
    expect(boardOf('  acme/7  ')).toEqual({ owner: 'acme', number: '7' });
    expect(boardOf('')).toBeNull();
    expect(boardOf('acme')).toBeNull();
    expect(boardOf('/7')).toBeNull();
    expect(boardOf('acme/')).toBeNull();
  });

  it('reads an issue key off a pull request and never composes one', () => {
    // An invented key transitions somebody else's ticket.
    expect(keyIn('feature/PROJ-42-a-thing')).toBe('PROJ-42');
    expect(keyIn('https://git.invalid/x/pull/1/head/ab1-9')).toBe('AB1-9');
    expect(keyIn('feature/a-thing')).toBeNull();
    expect(keyIn('')).toBeNull();
  });
});

describe('a repository with no tracker writes nowhere and says so', () => {
  it('answers unaskable on every operation, the write included', async () => {
    // ASSERTED: A REPO WITH NO `Tracker` DECLARED WRITES NOWHERE AND SAYS SO.
    // A silent no-op here reports a status reaching a tracker somebody
    // configured while nothing left the machine.
    const tracker = trackerNone();
    expect(await tracker.issueList()).toEqual({ ok: false, why: 'unaskable' });
    expect(await tracker.issueView('1')).toEqual({ ok: false, why: 'unaskable' });
    expect(await tracker.statusWrite({ prUrl: 'u', status: 'Done' })).toEqual({
      ok: false,
      why: 'unaskable',
    });
    expect(await tracker.limit()).toEqual({ ok: false, why: 'unaskable' });
  });

  it('is not refusing — there is nothing to ask', async () => {
    const tracker = trackerNone();
    await tracker.statusWrite({ prUrl: 'u', status: 'Done' });
    expect(tracker.lastRefusal()).toBeNull();
    expect(tracker.config()).toEqual({ scheme: '', baseUrl: '' });
  });

  it('never reaches a script, whatever it was asked', async () => {
    // The measurable form of *writes nowhere*: no connector, no process, no
    // config read. `trackerNone` takes no context at all, so there is nothing
    // it could spawn.
    expect(trackerNone.length).toBe(0);
  });
});

describe('a declared scheme names its connector, and an unknown one names none', () => {
  const context = () => scriptsThat({ 'plot-host.sh': 'exit 0' });

  it('routes each scheme to the connector that drives it', () => {
    expect(trackerFor('jira https://acme.atlassian.net', context()).config()).toEqual({
      scheme: 'jira',
      baseUrl: 'https://acme.atlassian.net',
    });
    expect(trackerFor('github-issues', context()).config().scheme).toBe('github-issues');
  });

  it('trims a trailing slash rather than composing a double one', () => {
    expect(trackerFor('jira https://acme.atlassian.net/', context()).config().baseUrl).toBe(
      'https://acme.atlassian.net',
    );
  });

  it('gives a scheme with no connector none, never a fall-through', async () => {
    // A SCHEME WITH NO ARM MUST NOT FALL THROUGH. A repository tracking with a
    // vendor Plot has no connector for would otherwise be shown the git host's
    // issues under that vendor's name — a list not wrong about any single row
    // and wrong about all of them.
    for (const declared of ['', 'plot', 'linear', 'something-nobody-wrote']) {
      const tracker = trackerFor(declared, context());
      expect(tracker.config()).toEqual({ scheme: '', baseUrl: '' });
      expect(await tracker.issueList()).toEqual({ ok: false, why: 'unaskable' });
    }
  });
});

describe('the fixture stands in for a tracker that is there', () => {
  const issue: Issue = {
    id: 'QF-1',
    title: 'The forge has an issue',
    url: 'https://quokka.invalid/issue/QF-1',
    createdAt: '2026-09-01T00:00:00Z',
    body: null,
  };

  it('answers every read the port defines', async () => {
    const tracker: Tracker = trackerFixture({ issues: [issue] });
    expect(answer<readonly Issue[]>(await tracker.issueList()).map((i) => i.id)).toEqual(['QF-1']);
    expect(answer<Issue>(await tracker.issueView('QF-1')).title).toBe('The forge has an issue');
    expect(answer<readonly LimitReading[]>(await tracker.limit())).toEqual([]);
  });

  it('records what was written, so a test can prove a write happened', async () => {
    // A FIXTURE THAT ONLY ANSWERED COULD NOT PROVE A WRITE REACHED THE TRACKER.
    const written: StatusWrite[] = [];
    const tracker = trackerFixture({ written });
    expect(answer<StatusOutcome>(await tracker.statusWrite({ prUrl: 'u', status: 'Done' }))).toBe(
      'written',
    );
    expect(written).toEqual([{ prUrl: 'u', status: 'Done' }]);
  });

  it('records a write that broke, because it was still an attempt', async () => {
    const written: StatusWrite[] = [];
    const tracker = trackerFixture({ written, statusWriteFails: true });
    expect(await tracker.statusWrite({ prUrl: 'u', status: 'Done' })).toEqual({
      ok: false,
      why: 'failed',
    });
    expect(written).toHaveLength(1);
  });

  it('is not the undeclared tracker beside it', async () => {
    // The fixture stands for a tracker that IS there; `trackerNone` stands for
    // a repository that declared none. A test using one for the other asserts
    // the opposite of what it means to.
    expect(await trackerFixture().issueList()).toEqual({ ok: true, value: [] });
    expect(await trackerNone().issueList()).toEqual({ ok: false, why: 'unaskable' });
  });
});
