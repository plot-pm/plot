import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, it, expect } from 'vitest';

import { hostShell } from '../src/adapters/host/host-shell.js';
import type { ShellContext } from '../src/adapters/scripts.js';

/**
 * A MOCKED HOST FAILS ON DEMAND.
 *
 * What is faked here is the host CLI, and nothing else. Each case writes a real
 * `plot-host.sh` into a real directory and lets `hostShell` spawn it: the
 * adapter, `runProcess`, `execFile`, the pipe and the exit code are all
 * production's. Only the thing on the far side of the script — a `gh` under a
 * rate limit, a tracker that is not configured — is replaced, which is the seam
 * `plot-host.sh` exists to own.
 *
 * THAT DISTINCTION IS THE POINT. `vitest.config.ts` warns that a threshold
 * forcing these branches to be faked teaches people to fake them, and mocking
 * `run-script.js` would cover every line below while deleting the process
 * boundary the branches exist to interpret. A stub returning a shape no host
 * produces is a green number standing for nothing.
 *
 * SO EVERY EXIT CODE AND EVERY PAYLOAD BELOW IS ONE `plot-host.sh` DOCUMENTS:
 *
 * - exit 1, empty stdout — `die()`, and what `gh` gives under a rate limit
 *   (measured 2026-08-30 against a nonexistent repo: exit=1, stdout empty)
 * - exit 3 — `die3()`, the question failed: an unconfigured Jira base URL, a
 *   404 from a tracker that moved
 * - exit 4 — the tracker-DISABLED case, this backend structurally has no answer
 * - `{"state":"NONE"}` on exit 0 — a lookup miss, which the script is explicit
 *   is an ANSWER and not a failure
 * - an empty list on exit 0 — a healthy host holding nothing
 */

const shells: string[] = [];

/** Builds a context whose `plot-host.sh` is the given script body. */
const hostThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-host-mock-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-host.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of shells) rmSync(dir, { recursive: true, force: true });
});

describe('a host that refuses', () => {
  it('reads a non-zero exit with empty stdout as failed', async () => {
    // `gh` under a rate limit: exit 1, nothing on stdout. The adapter must not
    // read the empty string as a payload — an unparsed stdout beside a failed
    // exit is the shape that turns an outage into a confident empty answer.
    const answer = await hostShell(hostThat('exit 1')).prList('open');
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 3 as failed — asked, and the question broke', async () => {
    // `die3`: a Jira with no base URL configured, or a 404 from a tracker that
    // moved. Retryable once somebody fixes the config.
    const answer = await hostShell(hostThat('exit 3')).issueList();
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 4 as unaskable — this backend has no answer at all', async () => {
    // The tracker-DISABLED case. Distinct from exit 3 on purpose: a caller told
    // to retry an unaskable source retries forever.
    const answer = await hostShell(hostThat('exit 4')).issueList();
    expect(answer).toEqual({ ok: false, why: 'unaskable' });
  });

  it('keeps a broken host apart from a host with no answer', async () => {
    const broke = await hostShell(hostThat('exit 3')).issueView('7');
    const cannot = await hostShell(hostThat('exit 4')).issueView('7');
    expect(broke).not.toEqual(cannot);
  });

  it('reads malformed JSON on a zero exit as failed', async () => {
    // The host answered, and answered nonsense — a truncated page, an error
    // banner printed onto stdout. A break, not an empty result: `resultOf`
    // catches the parse and reports failed rather than letting it throw.
    const answer = await hostShell(hostThat('echo "<html>rate limited</html>"; exit 0')).prState(
      'main',
    );
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('reads a malformed JSON line in a list as failed', async () => {
    const answer = await hostShell(hostThat('echo "{not json}"; exit 0')).prList('open');
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('refuses a backend word it does not recognise', async () => {
    // `backend` is the one operation with a closed vocabulary, and an
    // unrecognised word degrades to failed rather than being passed through as
    // a `HostBackend` the rest of the domain would branch on.
    const answer = await hostShell(hostThat('echo gitlab')).backend();
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('refuses a merge answer it does not recognise', async () => {
    const answer = await hostShell(hostThat('echo probably')).prMerged('some/branch');
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });
});

describe('a healthy host that holds nothing', () => {
  it('reads an empty list as an answer, not a failure', async () => {
    // ABSENT IS NOT NONE. This is the assertion the two above exist to be
    // distinguishable from: a host asked and holding nothing answers `[]`, and
    // a caller must be able to tell that from a host that could not be reached.
    const answer = await hostShell(hostThat('exit 0')).prList('open');
    expect(answer).toEqual({ ok: true, value: [] });
  });

  it('reads a lookup miss as an answer carrying null', async () => {
    // `plot-host.sh` prints `{"state":"NONE"}` on exit 0 for a branch with no
    // PR, and its header is explicit that this is an answer. Reading it as a
    // failure would make "no PR yet" indistinguishable from an outage.
    const answer = await hostShell(
      hostThat('echo \'{"number":0,"state":"NONE","draft":false,"url":""}\''),
    ).prState('branch/with-no-pr');
    expect(answer).toEqual({ ok: true, value: null });
  });

  it('tells an empty list apart from both refusals', async () => {
    const script = hostThat('exit 0');
    const empty = await hostShell(script).issueList();
    const broke = await hostShell(hostThat('exit 3')).issueList();
    const cannot = await hostShell(hostThat('exit 4')).issueList();
    expect(empty).not.toEqual(broke);
    expect(empty).not.toEqual(cannot);
  });
});

describe('a host that answers', () => {
  it('names a backend it recognises', async () => {
    expect(await hostShell(hostThat('echo bitbucket')).backend()).toEqual({
      ok: true,
      value: 'bitbucket',
    });
    expect(await hostShell(hostThat('echo github')).backend()).toEqual({
      ok: true,
      value: 'github',
    });
  });

  it('answers the merged question with each of its three words', async () => {
    for (const word of ['merged', 'not-merged', 'unknown'] as const) {
      const answer = await hostShell(hostThat(`echo ${word}`)).prMerged('some/branch');
      expect(answer).toEqual({ ok: true, value: word });
    }
  });

  it('reads exit 3 on the merged question as unknown, never as not-merged', async () => {
    // The one operation that overrides the exit-code mapping, and the reason it
    // does: every caller of `prMerged` is deciding whether to DELETE something,
    // so a host that could not be asked must not answer `not-merged`. It fails
    // safe toward keeping.
    const answer = await hostShell(hostThat('exit 3')).prMerged('some/branch');
    expect(answer).toEqual({ ok: true, value: 'unknown' });
  });

  it('passes a limit through, and omits it when unset', async () => {
    // The argument list is built by two ternaries. A limit that silently fails
    // to reach the script is how a truncated page reads as a complete one.
    const echoArgs = hostThat('printf "%s\\n" "$*" >&2; exit 0');
    await hostShell(echoArgs).prList('open', 25);
    await hostShell(echoArgs).issueList(10);
    const withLimit = await hostShell(
      hostThat('[ "$*" = "pr-list --state open --limit 25" ] || exit 1; exit 0'),
    ).prList('open', 25);
    expect(withLimit).toEqual({ ok: true, value: [] });
    const withoutLimit = await hostShell(
      hostThat('[ "$*" = "issue-list" ] || exit 1; exit 0'),
    ).issueList();
    expect(withoutLimit).toEqual({ ok: true, value: [] });
  });
});

describe('the host’s words are read against what the entity allows', () => {
  /** One PR row as the host prints it, with everything the mapper reads. */
  const fullPr = {
    number: 42,
    repo: 'plot-pm/plot',
    head: 'infra/a-branch',
    state: 'MERGED',
    mergedAt: '2026-08-30T10:00:00Z',
    mergeCommit: 'abc123',
    draft: true,
    mergeable: 'conflicting',
    review: 'APPROVED',
    checks: 'failing',
    failing_checks: ['build'],
    url: 'https://github.com/plot-pm/plot/pull/42',
  };

  it('reads every field a host states', async () => {
    const answer = await hostShell(
      hostThat(`cat <<'JSON'\n${JSON.stringify(fullPr)}\nJSON`),
    ).prList('all');
    expect(answer).toEqual({
      ok: true,
      value: [
        {
          number: 42,
          repo: 'plot-pm/plot',
          head: 'infra/a-branch',
          state: 'MERGED',
          mergedAt: '2026-08-30T10:00:00Z',
          mergeCommit: 'abc123',
          draft: true,
          mergeable: 'conflicting',
          review: 'APPROVED',
          checks: 'failing',
          failingChecks: ['build'],
          url: 'https://github.com/plot-pm/plot/pull/42',
        },
      ],
    });
  });

  it('degrades an unrecognised word toward unknown, never toward confidence', async () => {
    // A host wording nobody has seen — a new `mergeable` state, a review verdict
    // from a backend that spells it differently. Each fallback is the
    // cannot-verify member of its own enum, so an unknown word can never arrive
    // in the domain as `mergeable` or `green`.
    const answer = await hostShell(
      hostThat(
        `echo '${JSON.stringify({
          number: 1,
          state: 'ROLLED_UP',
          mergeable: 'behind',
          review: 'COMMENTED',
          checks: 'flaky',
        })}'`,
      ),
    ).prList('all');
    expect(answer).toMatchObject({
      ok: true,
      value: [{ state: 'OPEN', mergeable: 'unknown', review: '', checks: 'unknown' }],
    });
  });

  it('fills every unstated field rather than carrying undefined inward', async () => {
    // A host that omits a field has not said it is empty, but the entity has no
    // absent case — so the mapper decides once, here, rather than every rule
    // downstream re-deciding it.
    const answer = await hostShell(hostThat("echo '{}'")).prState('main');
    expect(answer).toEqual({
      ok: true,
      value: {
        number: 0,
        repo: '',
        head: '',
        state: 'OPEN',
        mergedAt: null,
        mergeCommit: '',
        draft: false,
        mergeable: 'unknown',
        review: '',
        checks: 'unknown',
        failingChecks: [],
        url: '',
      },
    });
  });

  it('reads a null mergedAt as null and keeps it apart from absent', async () => {
    const answer = await hostShell(hostThat('echo \'{"number":3,"mergedAt":null}\'')).prState('3');
    expect(answer).toMatchObject({ ok: true, value: { number: 3, mergedAt: null } });
  });
});

describe('an issue keeps its identifier as a string', () => {
  it('reads a numeric id and a Jira key the same way', async () => {
    // GitHub yields a number and Jira a key, and only one of them is a number
    // by accident of the host — so neither arrives in the domain as one.
    const github = await hostShell(
      hostThat('echo \'{"number":12,"title":"A bug","url":"u","createdAt":"2026-08-30","body":"B"}\''),
    ).issueView('12');
    expect(github).toEqual({
      ok: true,
      value: { id: '12', title: 'A bug', url: 'u', createdAt: '2026-08-30', body: 'B' },
    });

    const jira = await hostShell(hostThat('echo \'{"number":"PLOT-7","title":"A story"}\'')).issueView(
      'PLOT-7',
    );
    expect(jira).toMatchObject({ ok: true, value: { id: 'PLOT-7', title: 'A story' } });
  });

  it('fills an issue’s unstated fields, and a missing body stays null', async () => {
    // `issue-list` omits the body deliberately — it is asked on a timer for
    // every open issue. So null here means NOT FETCHED, and a caller deciding
    // *is this worth a plan?* must not read it as an empty problem statement.
    const answer = await hostShell(hostThat("echo '{}'")).issueList();
    expect(answer).toEqual({
      ok: true,
      value: [{ id: '', title: '', url: '', createdAt: null, body: null }],
    });
  });

  it('reads an empty createdAt as absent rather than as a timestamp', async () => {
    const answer = await hostShell(
      hostThat('echo \'{"number":4,"createdAt":"","body":""}\''),
    ).issueList();
    expect(answer).toMatchObject({ ok: true, value: [{ createdAt: null, body: '' }] });
  });
});
