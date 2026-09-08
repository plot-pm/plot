import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, it, expect } from 'vitest';

import { buildActions } from '../src/adapters/build/build-actions.js';
import { buildFor, buildShell } from '../src/adapters/build/build-resolve.js';
import type { ShellContext } from '../src/adapters/scripts.js';

/**
 * A MOCKED CI SYSTEM FAILS ON DEMAND.
 *
 * What is faked here is `plot-host.sh`, and nothing else. Each case writes a
 * real script into a real directory and lets the connector spawn it: the
 * connector, `runProcess`, `execFile`, the pipe and the exit code are all
 * production's. Only the thing on the far side of the script — a GitHub under
 * a rate limit, a Jenkins that is down — is replaced, which is the seam
 * `plot-host.sh` exists to own. It is the shape `tracker-shell.test.ts` uses,
 * and for the same reason.
 *
 * WHAT THIS CANNOT PROVE is the ANSWER'S shape. A stub asserts *given this
 * output, the connector does X*; only a real instance says the output looks
 * like that. Every payload below is one `plot-host.sh` documents in its own
 * usage block, which is the closest a fixture gets.
 */

const shells: string[] = [];

/** Builds a context whose `plot-host.sh` is the given script body. */
const hostThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-build-mock-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

/** Builds a context whose `plot-config.sh` answers the `CI` key with one word. */
const declaring = (ci: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-build-config-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const config = join(scriptDir, 'plot-config.sh');
  writeFileSync(config, `#!/usr/bin/env bash\nprintf '%s\\n' '${ci}'\n`);
  chmodSync(config, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of shells) rmSync(dir, { recursive: true, force: true });
});

describe('a CI connector reads a branch’s history', () => {
  it('reads what the system printed as runs, newest first', async () => {
    const answer = await buildActions(
      hostThat(
        `printf '%s\\n' '{"workflow":"CI","conclusion":"failure","startedAt":"2026-09-07T10:00:00Z","url":"https://x.invalid/2"}' ` +
          `'{"workflow":"CI","conclusion":"success","startedAt":"2026-09-07T09:58:00Z","url":"https://x.invalid/1"}'`,
      ),
    ).runs('feature/x');
    expect(answer).toEqual({
      ok: true,
      value: [
        {
          workflow: 'CI',
          conclusion: 'failure',
          startedAt: '2026-09-07T10:00:00Z',
          url: 'https://x.invalid/2',
        },
        {
          workflow: 'CI',
          conclusion: 'success',
          startedAt: '2026-09-07T09:58:00Z',
          url: 'https://x.invalid/1',
        },
      ],
    });
  });

  it('keeps a conclusion the system invented next, rather than narrowing it', async () => {
    // Narrowing to a known set would map every outcome the vendor adds onto one
    // it already has, and a history exists to be read rather than classified.
    const answer = await buildActions(
      hostThat(`echo '{"workflow":"CI","conclusion":"action_required"}'`),
    ).runs('feature/x');
    expect(answer).toMatchObject({ ok: true, value: [{ conclusion: 'action_required' }] });
  });

  it('answers an empty history where the system holds none for the branch', async () => {
    // ASKED, AND HOLDS NOTHING. Different from `unaskable`, which is what a
    // repository with no CI answers.
    expect(await buildActions(hostThat('exit 0')).runs('feature/x')).toEqual({
      ok: true,
      value: [],
    });
  });

  it('reads exit 4 as unaskable — this system has no answer at all', async () => {
    expect(await buildActions(hostThat('exit 4')).runs('feature/x')).toEqual({
      ok: false,
      why: 'unaskable',
    });
  });

  it('keeps a broken call apart from one that cannot be asked', async () => {
    const broke = await buildActions(hostThat('exit 3')).runs('feature/x');
    const cannot = await buildActions(hostThat('exit 4')).runs('feature/x');
    expect(broke).toEqual({ ok: false, why: 'failed' });
    expect(broke).not.toEqual(cannot);
  });

  it('passes a limit through, and omits it when unset', async () => {
    // A limit that silently fails to reach the script is how a truncated page
    // reads as a complete one.
    const withLimit = await buildActions(
      hostThat('[ "$*" = "runs feature/x --limit 10" ] || exit 1; exit 0'),
    ).runs('feature/x', 10);
    expect(withLimit).toEqual({ ok: true, value: [] });
    const without = await buildActions(
      hostThat('[ "$*" = "runs feature/x" ] || exit 1; exit 0'),
    ).runs('feature/x');
    expect(without).toEqual({ ok: true, value: [] });
  });
});

describe('a CI connector reads the run for one commit', () => {
  /** The object shape `plot-host.sh run-for-sha` documents. */
  const run = (sha: string, status: string, conclusion: string | null) =>
    hostThat(
      `echo '{"sha":"${sha}","status":"${status}",` +
        `"conclusion":${conclusion === null ? 'null' : `"${conclusion}"`},` +
        `"url":"https://x.invalid/9","startedAt":"2026-09-07T10:00:00Z"}'`,
    );

  it('reads the run, with the sha it is actually for', async () => {
    const answer = await buildActions(run('abc123', 'completed', 'success')).runForSha(
      'feature/x',
      'abc123',
    );
    expect(answer).toEqual({
      ok: true,
      value: {
        sha: 'abc123',
        status: 'completed',
        conclusion: 'success',
        url: 'https://x.invalid/9',
        startedAt: '2026-09-07T10:00:00Z',
      },
    });
  });

  it('carries a sha that is NOT the one asked about', async () => {
    // The script falls back to the branch's newest run and says which it is,
    // because a run in flight for a superseded commit would otherwise report
    // identically to no run at all. The connector must not flatten that.
    const answer = await buildActions(run('newer', 'in_progress', null)).runForSha(
      'feature/x',
      'asked-about',
    );
    expect(answer).toMatchObject({ ok: true, value: { sha: 'newer' } });
  });

  it('keeps a null conclusion null while the run is still going', async () => {
    // THE ONE FIELD WHERE ABSENT AND EMPTY DIFFER. An empty string here would
    // read as a conclusion the system reported.
    const answer = await buildActions(run('abc123', 'in_progress', null)).runForSha(
      'feature/x',
      'abc123',
    );
    expect(answer).toMatchObject({ ok: true, value: { conclusion: null, status: 'in_progress' } });
  });

  it('answers null where the branch has no runs at all', async () => {
    // AN ANSWER, and the common one: a caller polling a fresh push sees exactly
    // this until CI wakes up. Handing an empty stdout to the JSON parser would
    // report a healthy poll as a broken call.
    expect(await buildActions(hostThat('exit 0')).runForSha('feature/x', 'abc')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('reads malformed JSON on a zero exit as failed', async () => {
    // The system answered, and answered nonsense — an error banner printed onto
    // stdout. A break, not an empty result.
    const answer = await buildActions(
      hostThat('echo "<html>rate limited</html>"; exit 0'),
    ).runForSha('feature/x', 'abc');
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('passes the branch, the sha and the limit through', async () => {
    const answer = await buildActions(
      hostThat('[ "$*" = "run-for-sha feature/x abc --limit 20" ] || exit 1; exit 0'),
    ).runForSha('feature/x', 'abc', 20);
    expect(answer).toEqual({ ok: true, value: null });
  });
});

describe('a CI connector answers for its OWN limit', () => {
  it('asks ci-limit, never the git host’s limit', async () => {
    // THE SEPARATION THIS PORT EXISTS FOR. A connector reading the git host's
    // headroom would hand a caller a budget it never measured.
    const answer = await buildActions(
      hostThat(
        `case "$1" in\n` +
          `  ci-limit) echo '{"connector":"github-actions","bucket":"","limit":60,"basis":"predicted"}' ;;\n` +
          `  limit) echo '{"connector":"github","bucket":"core","limit":5000,"basis":"actual"}' ;;\n` +
          `esac\nexit 0`,
      ),
    ).limit();
    expect(answer).toMatchObject({
      ok: true,
      value: [{ connector: 'github-actions', limit: 60, basis: 'predicted' }],
    });
  });

  it('drops a reading belonging to another connector', async () => {
    // `plot-host.sh` prints what it resolved, and a connector must not report
    // another service's bucket as its own.
    const answer = await buildActions(
      hostThat(`echo '{"connector":"jenkins","bucket":"","limit":60,"basis":"predicted"}'`),
    ).limit();
    expect(answer).toEqual({ ok: true, value: [] });
  });

  it('answers an empty list where the connector meters nothing', async () => {
    // An ANSWER, and not `free`: there is no reading to read.
    expect(await buildActions(hostThat('exit 0')).limit()).toEqual({ ok: true, value: [] });
  });

  it('refuses to carry a number on an unknown basis', async () => {
    const answer = await buildActions(
      hostThat(
        `echo '{"connector":"github-actions","bucket":"","limit":5000,"basis":"guessed"}'`,
      ),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ basis: 'unknown', limit: null }] });
  });

  it('reads a reset in seconds as milliseconds', async () => {
    const answer = await buildActions(
      hostThat(
        `echo '{"connector":"github-actions","bucket":"","limit":60,"reset":1788269670,"basis":"actual"}'`,
      ),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ resetAt: 1_788_269_670_000 }] });
  });
});

describe('a CI connector reports why it did not answer', () => {
  it('names what the script said, verbatim', async () => {
    const build = buildActions(hostThat('echo "gh: API rate limit exceeded" >&2; exit 3'));
    await build.runs('feature/x');
    expect(build.lastRefusal()).toBe('gh: API rate limit exceeded');
  });

  it('reports exit 4 as no refusal at all', async () => {
    // A standing configuration fact rather than an incident worth waiting out.
    // A caller told to back off from one backs off forever.
    const build = buildActions(hostThat('exit 4'));
    await build.runs('feature/x');
    expect(build.lastRefusal()).toBeNull();
  });

  it('clears the refusal once a call answers', async () => {
    // Read immediately after the call it is about and never later.
    const build = buildActions(hostThat('[ "$1" = runs ] && exit 3; exit 0'));
    await build.runs('feature/x');
    expect(build.lastRefusal()).not.toBeNull();
    await build.limit();
    expect(build.lastRefusal()).toBeNull();
  });

  it('names the exit code where the script said nothing', async () => {
    const build = buildActions(hostThat('exit 3'));
    await build.runs('feature/x');
    expect(build.lastRefusal()).toBe('plot-host.sh exited 3');
  });
});

describe('a declared CI system resolves to its own connector', () => {
  const context = hostThat('exit 0');

  it('routes github-actions to the Actions connector', () => {
    expect(buildFor('github-actions', context).system()).toBe('github-actions');
  });

  it('reads the word case-insensitively and ignores surrounding space', () => {
    expect(buildFor('  GitHub-Actions \n', context).system()).toBe('github-actions');
  });

  it('routes a system with no connector to none, never to the nearest one', async () => {
    // A repository building on a system Plot has no connector for would
    // otherwise be shown another vendor's runs under its name.
    const build = buildFor('gitlab-ci', context);
    expect(build.system()).toBe('');
    expect(await build.runs('feature/x')).toEqual({ ok: false, why: 'unaskable' });
  });

  it('routes jenkins to none while no Jenkins connector exists', async () => {
    // THE HONEST ANSWER TODAY, and the next slice's one line here. Claiming a
    // connector that does not exist would report an absent capability as an
    // empty run list.
    expect(buildFor('jenkins', context).system()).toBe('');
  });

  it('routes a repository that declared nothing to none', async () => {
    expect(buildFor('', context).system()).toBe('');
  });

  it('reads the CI key from the repository’s config', async () => {
    expect((await buildShell(declaring('github-actions'))).system()).toBe('github-actions');
    expect((await buildShell(declaring(''))).system()).toBe('');
  });

  it('treats a config it could not read as no CI system', async () => {
    // Guessing a connector here would render another vendor's runs under a name
    // nobody declared.
    const broken = mkdtempSync(join(tmpdir(), 'plot-build-noconfig-'));
    shells.push(broken);
    mkdirSync(join(broken, 'scripts'));
    expect((await buildShell({ repoRoot: broken, scriptDir: join(broken, 'scripts') })).system()).toBe(
      '',
    );
  });
});
