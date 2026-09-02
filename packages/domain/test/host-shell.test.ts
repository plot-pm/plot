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

  it('refuses a backend it cannot drive', async () => {
    // THE ADAPTER'S REFUSAL, NOT THE TYPE'S. `HostBackend` is any string — the
    // domain holds no vendor list — so this is the layer that says no, and it
    // is the right one: driving a host means a CLI this adapter has been taught,
    // and it is the only layer that could be taught it.
    //
    // `gitlab` is refused for the same reason it always was, one layer down.
    const answer = await hostShell(hostThat('echo gitlab')).backend();
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('names the host it could not drive, and what it drives instead', async () => {
    // THE REFUSAL HAS TO SAY WHICH HOST. Removing the union moved this refusal
    // from the compiler to here, and the compiler named the vendor — a `failed`
    // with no sentence is a worse answer than the type used to give.
    //
    // `PortResult` carries no sentence, so `lastRefusal` is the only place the
    // name can survive. Asserted separately from the refusal above because the
    // two failed independently: the guard threw from the day the union went,
    // and the message it threw was discarded by `resultOf` until 2026-09-02 —
    // `lastRefusal()` answered `null`, since the script exited 0 and `record`
    // clears the refusal on a zero exit.
    const host = hostShell(hostThat('echo quokka-forge'));
    await host.backend();
    const refusal = host.lastRefusal();
    expect(refusal?.kind).toBe('failed');
    expect(refusal?.said).toContain('quokka-forge');
    expect(refusal?.said).toContain('github');
  });

  it('holds no refusal once it drives a host it was taught', async () => {
    // The other half: a refusal that never clears would report the last
    // unknown host forever, and every caller reading `lastRefusal` after a
    // good call would back off for a reason that no longer exists.
    const host = hostShell(hostThat('echo github'));
    await host.backend();
    expect(host.lastRefusal()).toBeNull();
  });

  it('drives a backend it was taught, and the domain never sees the list', async () => {
    // The other half of the refusal above: the guard admits what it can drive
    // and passes the word through unnarrowed. Asserting only the refusal would
    // pass against a guard that refused everything.
    const answer = await hostShell(hostThat('echo bitbucket')).backend();
    expect(answer).toEqual({ ok: true, value: 'bitbucket' });
  });

  it('refuses a merge answer it does not recognise', async () => {
    const answer = await hostShell(hostThat('echo probably')).prMerged('some/branch');
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });
});

/**
 * THE TWO LIMITS SURVIVE THE TRIP FROM THE SCRIPT.
 *
 * `plot-host.sh` splits its refusals off the host's wording — exit 5 for a spent
 * quota, exit 6 for a secondary limit — and that split is worth nothing if the
 * adapter folds them back into one word. Asserted through a real spawn of a real
 * script, so the exit code travels the production path.
 */
describe('a refusal names which limit it hit', () => {
  it('reads exit 5 as a spent quota', async () => {
    const host = hostShell(hostThat('echo "API rate limit already exceeded" >&2; exit 5'));
    await host.prList('open');
    expect(host.lastRefusal()?.kind).toBe('throttled');
  });

  it('reads exit 6 as a secondary limit', async () => {
    const host = hostShell(
      hostThat('echo "You have exceeded a secondary rate limit" >&2; exit 6'),
    );
    await host.prList('open');
    expect(host.lastRefusal()?.kind).toBe('secondary');
  });

  /**
   * The whole point of the split: the two arrive as different words. A single
   * assertion on either alone passes just as well against a mapping that
   * answers `throttled` for both.
   */
  it('keeps the two apart rather than answering one word for both', async () => {
    const quota = hostShell(hostThat('exit 5'));
    const secondary = hostShell(hostThat('exit 6'));
    await quota.prList('open');
    await secondary.prList('open');
    expect(quota.lastRefusal()?.kind).not.toBe(secondary.lastRefusal()?.kind);
  });

  /**
   * THE SPLIT FALLS ONE WAY ONLY. An exit code the mapping does not know must
   * not be promoted into a limit: both limit words counsel a wait, and a wait
   * does not fix an auth error.
   */
  it('gives no exit code it does not know the more specific name', async () => {
    const host = hostShell(hostThat('exit 7'));
    await host.prList('open');
    expect(host.lastRefusal()?.kind).toBe('failed');
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

/**
 * The connector answering for its own limit.
 *
 * The script is faked the same way everything above is: a real `plot-host.sh`
 * on disk, spawned by the real adapter, printing what a real one prints. Two
 * ops are asked — `limit` for the git host and `ci-limit` for CI, which is a
 * separate axis — so each body below branches on `$1`.
 */
describe('a connector answers for its limit', () => {
  /** A script answering `limit` with one body and `ci-limit` with another. */
  const limitsOf = (git: string, ci = '') =>
    hostThat(
      `case "$1" in\n` +
        `  limit) ${git === '' ? ':' : `printf '%s\\n' '${git}'`} ;;\n` +
        `  ci-limit) ${ci === '' ? ':' : `printf '%s\\n' '${ci}'`} ;;\n` +
        `esac\nexit 0`,
    );

  it('reads what the connector reported as an ACTUAL reading', async () => {
    // The GitHub case: `X-RateLimit-Limit`/`Remaining`/`Resource` off a real
    // response, which is the only reading that has ever been right — the
    // `rate_limit` endpoint reported 5000/5000 used 0 while these headers read
    // 1236 remaining, 3764 used, same account, seconds apart, 2026-09-01.
    const answer = await hostShell(
      limitsOf(
        '{"connector":"github","bucket":"graphql","limit":5000,"remaining":1236,"reset":1788269670,"basis":"actual"}',
      ),
    ).limit();
    expect(answer).toEqual({
      ok: true,
      value: [
        {
          connector: 'github',
          bucket: 'graphql',
          limit: 5000,
          remaining: 1236,
          resetAt: 1_788_269_670_000,
          basis: 'actual',
        },
      ],
    });
  });

  it('reads a value from experience as PREDICTED, and it is answered', async () => {
    // A `predicted` limit is not a failure. The adapter is telling the truth
    // about what it knows, and a caller that read this as `failed` would treat
    // an honest answer as an outage.
    const answer = await hostShell(
      limitsOf(
        '',
        '{"connector":"jenkins","bucket":"","limit":60,"remaining":null,"reset":null,"basis":"predicted"}',
      ),
    ).limit();
    expect(answer).toEqual({
      ok: true,
      value: [
        {
          connector: 'jenkins',
          bucket: '',
          limit: 60,
          remaining: null,
          resetAt: null,
          basis: 'predicted',
        },
      ],
    });
  });

  it('reads a connector that reports nothing as UNKNOWN, never as free', async () => {
    const answer = await hostShell(
      limitsOf(
        '{"connector":"trello","bucket":"","limit":null,"remaining":null,"reset":null,"basis":"unknown"}',
      ),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ basis: 'unknown', limit: null }] });
  });

  it('refuses to carry a number on an unknown basis', async () => {
    // A script that contradicted itself — `basis: unknown` beside a number — is
    // the collapse this slice exists to refuse. The mapper decides once, here,
    // rather than letting every rule downstream re-decide which field to trust.
    const answer = await hostShell(
      limitsOf('{"connector":"x","bucket":"","limit":5000,"basis":"unknown"}'),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ limit: null }] });
  });

  it('degrades a basis word it does not recognise toward unknown', async () => {
    // The cannot-verify member of this enum is `unknown`. A word nobody has
    // seen must never arrive as `actual`, which is the one basis a caller is
    // entitled to trust.
    const answer = await hostShell(
      limitsOf('{"connector":"x","bucket":"b","limit":9,"basis":"guessed"}'),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ basis: 'unknown', limit: null }] });
  });

  it('reads an absent remaining as null rather than as a spent bucket', async () => {
    // ABSENT IS NOT ZERO, and here it costs something real: `remaining: 0` says
    // every call is refused, while an unreported one says the connector did not
    // say. A fallback of 0 would read silence as exhaustion.
    const answer = await hostShell(
      limitsOf('{"connector":"github","bucket":"core","limit":5000,"basis":"actual"}'),
    ).limit();
    expect(answer).toMatchObject({ ok: true, value: [{ remaining: null, resetAt: null }] });
    const spent = await hostShell(
      limitsOf(
        '{"connector":"github","bucket":"core","limit":5000,"remaining":0,"basis":"actual"}',
      ),
    ).limit();
    expect(spent).toMatchObject({ ok: true, value: [{ remaining: 0 }] });
  });

  it('gathers the git host and CI, which are separate axes', async () => {
    // This repo is GitHub + Actions; `ekzweb` is Bitbucket + Jenkins. And
    // Actions minutes are a quota distinct from the API's 5000/hr, so "the
    // connector is github" does not identify the bucket.
    const answer = await hostShell(
      limitsOf(
        '{"connector":"bitbucket","bucket":"api","limit":1000,"basis":"predicted"}',
        '{"connector":"jenkins","bucket":"","limit":60,"basis":"predicted"}',
      ),
    ).limit();
    expect(answer).toMatchObject({
      ok: true,
      value: [{ connector: 'bitbucket' }, { connector: 'jenkins' }],
    });
  });

  it('answers an empty list where the connector meters nothing', async () => {
    // An ANSWER, and not `free`. There is no reading to read, which a caller
    // can tell from a reading that says 5000.
    expect(await hostShell(limitsOf('')).limit()).toEqual({ ok: true, value: [] });
  });

  it('fails where the git host could not be asked at all', async () => {
    // *Could not ask* and *asked, and it reports no limit* are different facts.
    // Collapsing them is how an outage reads as a connector with no budget.
    const answer = await hostShell(hostThat('exit 3')).limit();
    expect(answer).toEqual({ ok: false, why: 'failed' });
  });

  it('still answers for the git host when CI cannot be asked', async () => {
    // A Jenkins that is down says nothing about the GitHub budget the caller
    // came for.
    const script = hostThat(
      `case "$1" in\n` +
        `  limit) echo '{"connector":"github","bucket":"graphql","limit":5000,"basis":"actual"}' ;;\n` +
        `  ci-limit) exit 3 ;;\n` +
        `esac\nexit 0`,
    );
    expect(await hostShell(script).limit()).toMatchObject({
      ok: true,
      value: [{ connector: 'github' }],
    });
  });
});

describe('a refusal corrects the prediction for the rest of the session', () => {
  /** A script whose `limit` answer never changes, so only the adapter can learn. */
  const stubbornJenkins = () =>
    hostThat(
      `case "$1" in\n` +
        `  ci-limit) echo '{"connector":"jenkins","bucket":"","limit":60,"basis":"predicted"}' ;;\n` +
        `esac\nexit 0`,
    );

  /** The limit one reading carries, or null. */
  const limitIn = (answer: Awaited<ReturnType<ReturnType<typeof hostShell>['limit']>>) =>
    answer.ok ? (answer.value[0]?.limit ?? null) : null;

  it('LOWERS the number the next read reports', async () => {
    // THE DISCRIMINATING ASSERTION. The script answers 60 every time, so if the
    // second read still says 60 the adapter learnt nothing — and a test that
    // only checked the basis was still `predicted` would have passed.
    const host = hostShell(stubbornJenkins());
    expect(limitIn(await host.limit())).toBe(60);
    host.observe('throttled');
    expect(limitIn(await host.limit())).toBe(30);
  });

  it('keeps correcting across refusals rather than resetting each read', async () => {
    const host = hostShell(stubbornJenkins());
    await host.limit();
    host.observe('throttled');
    await host.limit();
    host.observe('throttled');
    expect(limitIn(await host.limit())).toBe(15);
  });

  it('learns nothing from a call that succeeded', async () => {
    const host = hostShell(stubbornJenkins());
    await host.limit();
    host.observe('ok');
    expect(limitIn(await host.limit())).toBe(60);
  });

  it('leaves an ACTUAL reading alone — a header is not an inference', async () => {
    // A refusal beside a reported ceiling means something other than a wrong
    // ceiling: a secondary limit, a burst. Lowering the number the connector
    // itself gave would overwrite a measurement with a guess.
    const host = hostShell(
      hostThat(
        `case "$1" in\n` +
          `  limit) echo '{"connector":"github","bucket":"graphql","limit":5000,"remaining":1236,"basis":"actual"}' ;;\n` +
          `esac\nexit 0`,
      ),
    );
    expect(limitIn(await host.limit())).toBe(5000);
    host.observe('throttled');
    expect(limitIn(await host.limit())).toBe(5000);
  });

  it('keeps each session apart — one adapter’s learning is not another’s', async () => {
    // The correction is the SESSION's. Two adapters over the same script are
    // two sessions, and a correction leaking between them would be a persisted
    // record wearing a session's clothes — which is another slice's question.
    const learned = hostShell(stubbornJenkins());
    await learned.limit();
    learned.observe('throttled');
    expect(limitIn(await learned.limit())).toBe(30);
    expect(limitIn(await hostShell(stubbornJenkins()).limit())).toBe(60);
  });

  it('records nothing from a refusal observed before anything was read', async () => {
    // An observation is evidence about a reading. With no reading in hand there
    // is nothing to lower, and inventing one would be the adapter predicting a
    // connector it has not asked.
    const host = hostShell(stubbornJenkins());
    host.observe('throttled');
    expect(limitIn(await host.limit())).toBe(60);
  });
});
