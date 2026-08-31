import {
  type AgentRow,
  type Fleet,
} from '../../../contract/schema.js';

/**
 * What the empty WAITING ON A MACHINE section says where the host cannot answer.
 *
 * The default hint — *nothing — a machine is working* — is a claim: it says no
 * machine is working on any of this right now. On a host that cannot report
 * checks or mergeability that claim is unfounded for the CI half of the section,
 * and the section is then empty for a completely different reason: nobody
 * looked, because nobody could. A local process would still be listed — that
 * half is observed here rather than asked of the host — which is why the hint
 * only ever replaces the sentence of an EMPTY section.
 *
 * Measured: the Bitbucket adapter emits a literal `checks:"unknown",
 * mergeable:"unknown"` on every row, because `bb` has no run listing. That is
 * not deferred work — it is the CLI's limit — so this section is permanently
 * empty there, and an unexplained empty section reads as *nothing is running*
 * for as long as the board is open.
 *
 * **Absent is not a clearance**, applied to a section instead of a field. The
 * hint names the host's limit so the emptiness reads as *I cannot tell you*
 * rather than as *all quiet*.
 */
export const HOST_CANNOT_REPORT_HINT = 'this host cannot report CI';

/**
 * Whether every PR on the board came back unreadable.
 *
 * The condition for `HOST_CANNOT_REPORT_HINT`, and it is deliberately ALL and
 * not ANY: one `unknown` row among readable ones is a single PR mid-outage or a
 * single cross-host repo, and the section is then empty for the ordinary reason.
 * Only when no PR anywhere answered is the section's emptiness attributable to
 * the host rather than to the fleet.
 *
 * Rows WITHOUT a PR are not counted either way — they have nothing to report and
 * are not evidence about the host. A board with no PRs at all therefore answers
 * `false`: nothing has been observed, so nothing can be concluded, and claiming
 * a host limit from an absence of evidence would be the very mistake this hint
 * exists to correct.
 *
 * **A MERGED ROW IS NOT EVIDENCE EITHER**, by that same rule and for the same
 * reason. A merged PR reports `mergeable: "unknown"` on GitHub — the question
 * stops being computed once the branch lands — so it reaches this function as
 * `state: 'unknown'` on a host that answers CI perfectly well. It is not an
 * outage and not a host limit; it is a finished PR having no live condition to
 * report, which is the *nothing to report* case one line up.
 *
 * Excluded from 2026-08-20, when the row began carrying its merged PR's link.
 * Before that a merged branch had no `pr` at all and fell out of this tally by
 * accident; keeping it in would have turned a plan of merged branches plus one
 * PR mid-outage into a false claim about the host — with the hint's own words
 * ("nobody could look") printed under a section that was simply quiet.
 *
 * Exported for test.
 */
/**
 * What a row says WHEN LISTED AS A PROCESS — the machine section's sentence,
 * never the branch's.
 *
 * THE SECTION'S SENTENCE IS ABOUT THE MACHINE, never about who holds the
 * branch. `note` is the row's own sentence and may be about an agent — *worker
 * running (pid 20145)* — which is a true statement in WORKING and no answer at
 * all to *what am I waiting on?*
 *
 * EVIDENCE, NEVER A FORECAST, and this is where that rule is visible to a
 * reader. The sentence names what was OBSERVED — *CI is running for PR #244* —
 * and never a remaining time. GitHub publishes no finish time for a queued
 * check, and a countdown nobody can honour is the shape this repo removes rather
 * than adds. Principle 3: the scan collects, the reader concludes whether to
 * wait.
 *
 * JOINS WHAT IT IS GIVEN, NEVER RANKING IT. Only host entries reach the row
 * since `machineProcesses` stopped writing a local one, so in practice this
 * joins nothing — but a row with two pending checks is a row with two machines
 * on it, and dropping either because the other came first is the displacement
 * this board keeps undoing.
 *
 * FALLS BACK TO `note` for a row that reached the section through `group` with
 * no process listed — a `pending` check from an older pulse that predates
 * `processes`. Its note already reads *PR #244, CI running*, which is exactly
 * this sentence by the other road, so the fallback changes nothing that renders
 * and keeps an older payload from going blank.
 */
export function machineNote(row: AgentRow): string {
  const procs = processesOf(row);
  if (procs.length === 0) return row.note;
  return procs.map((proc) => proc.evidence).join('; ');
}

/**
 * This row's processes, tolerating a payload that has none of the field at all.
 *
 * THE CLIENT IS SERVED BY A SERVER IT DOES NOT VERSION WITH. The board's page is
 * a built artifact that a reader may have open across a restart, and
 * `/api/fleet` answers from whichever server is running — so a row can arrive
 * without `processes` even though the schema defaults it to `[]`, because the
 * default applies where the payload is PARSED and the client renders what it was
 * handed. Reading `.length` off an absent array crashes the whole board, and a
 * blank page is a far worse answer to a missing convenience field than an empty
 * list is.
 *
 * ABSENT IS NOT FALSE, applied as the codebase applies it everywhere else: an
 * empty result here means *nothing was reported*, and the section then falls back
 * to `group` — exactly the board's behaviour before this field existed.
 */
function processesOf(row: AgentRow): AgentRow['processes'] {
  return row.processes ?? [];
}

/**
 * Whether this row belongs in WAITING ON A MACHINE — the server's grouping, and
 * nothing added to it.
 *
 * AN AGENT IS THE MACHINE, NEVER THE WAIT. The section answers *what am I
 * waiting on?* and holds a branch, a PR or a plan whose progress depends on
 * something automated. An agent is not an answer to that question — it is the
 * thing doing the work, and WORKING says so while also saying *who*.
 *
 * THIS PREDICATE USED TO ADD A SECOND CLAUSE, `|| processesOf(row).length > 0`,
 * and that clause is what put agents here. It was written for *"an agent
 * watching its own CI"* — listed twice, once as an agent and once as a process —
 * but that case is two subjects, not one subject twice: the agent goes to
 * WORKING and the PR comes here through `group`, each once. What the clause
 * actually keyed on was *a process is running*, and an agent is always a
 * process, so it fired for every live worker. Measured 2026-08-20:
 * `bug/one-component-renders-every-row` rendered in both sections with
 * **`pr: None`** — nothing automated anywhere near it.
 *
 * KEYED ON `group` ALONE, rather than on `processes` filtered to host entries,
 * and the difference is where the guarantee lives. `machineProcesses` no longer
 * writes a local entry, so both spellings render the same rows today — but a
 * predicate that reads `processes` holds *no agent reaches this section* only
 * for as long as that other file keeps its promise, which is a rule in a second
 * place. Reading `group` makes it structural: the client cannot admit a row the
 * server did not group, whatever `processes` later carries. The field stays on
 * the row and `machineNote` still reads it for the section's sentence — this
 * decides MEMBERSHIP, and membership has one source.
 */
export function inMachineSection(row: AgentRow): boolean {
  return row.group === 'waiting-on-machine';
}

export function hostCannotReportCi(rows: readonly AgentRow[]): boolean {
  const withPr = rows.filter((r) => r.pr && r.state !== 'merged');
  return withPr.length > 0 && withPr.every((r) => r.pr!.state === 'unknown');
}

/**
 * Which clock the host-derived sections were read from.
 *
 * Four answers, because the board has four situations and printed one word for
 * two of them. `none` under WAITING ON A MACHINE was shown both when the host
 * had answered and reported nothing pending, and when the host had not been
 * asked at all — opposite situations wanting opposite responses, with the
 * reassuring one as the default.
 *
 * Measured 2026-08-18 from two screenshots of one board 22 seconds apart. At
 * `PR data 22s ago` the section read `none` and no row carried a status; at
 * `PR data 4s ago` the same board reported #57 `conflicts`, #196 `checks
 * failing` since the previous day, and #203 `CI running`. Nothing changed on
 * the host between them. A branch whose CI had been red overnight presented as
 * unremarkable, and the operator read the board as having LOST its state when
 * it had simply not yet fetched it.
 *
 * This is `docs/plans/2026-08-17-an-outage-is-not-an-answer.md`'s rule — a
 * failure to observe must not be reported as an observation — at the one
 * boundary that plan did not cross. An outage at least produces an error to
 * carry; a first fetch that has not happened produces nothing at all, which is
 * how it survived a plan written to catch exactly this shape.
 *
 * FOUR STATES, NOT THREE. `unreachable` is deliberately not folded into
 * `unasked`, and that was the plan's one open question. Both mean *no host
 * fact is on this board*, so one label would be defensible — but they want
 * different responses. `unasked` resolves itself in seconds and asks the reader
 * for nothing; `unreachable` will not resolve until somebody looks at the
 * error, and `an-outage-is-not-an-answer` is the plan that established an
 * outage must be visible AS an outage. Collapsing them would re-file a standing
 * fault as a passing one.
 *
 * The distinction costs nothing to compute, because the server already draws
 * it: `refreshPrs` leaves `prAt` untouched when the call throws (`fleet.ts`),
 * so a null age beside an error is a FIRST fetch that failed, while a null age
 * with no error is a fetch not yet made. The footer has read the pair this way
 * all along — `· no PR data yet` is already gated on both.
 *
 * A FIRST-LOAD STATE, NOT A STALENESS DISPLAY. Once the host has answered,
 * every later answer is `answered` no matter how old, because ordinary ageing
 * is what the footer reports (`PR data 111s ago`) and re-labelling every
 * section every 60 s would trade one misreading for a flicker. `prAgeSeconds`
 * is therefore tested against null and never against a threshold.
 *
 * THE SCAN'S OWN AGE IS NOT CONSULTED. `fleet.ageSeconds` dates the git scan,
 * which is cheap and runs every few seconds; `prAgeSeconds` dates the host,
 * which is metered and runs every 60. Conflating them into one page age is what
 * let a git-fresh board read as host-fresh, so a PR-derived field must never
 * borrow the scan's clock.
 *
 * Exported for test.
 */
export type HostAnswer = 'answered' | 'unasked' | 'unreachable';

/**
 * Read the host's answer state off a fleet.
 *
 * Reads ONLY the two PR fields. Passing the whole fleet would let a later edit
 * reach for `ageSeconds` and silently reintroduce the conflation this exists to
 * remove, so the parameter names exactly what it is allowed to see.
 */
export function hostAnswer(
  fleet: Pick<Fleet, 'prAgeSeconds' | 'prError'>,
): HostAnswer {
  if (fleet.prAgeSeconds !== null) return 'answered';
  return fleet.prError ? 'unreachable' : 'unasked';
}

/**
 * What an empty host-fed section says when the host has not answered.
 *
 * EVIDENCE, NOT VERDICT. Each says what happened to the call and stops there:
 * no estimate, no retry count, and above all no *probably fine*. The rule the
 * scan's own outputs follow — scripts collect, humans conclude (Manifesto
 * Principle 3).
 *
 * Both must avoid the shape of the default hint (*nothing — a machine is
 * working*), which is a CLAIM about the machines. An empty section that still implies
 * something is running is the failure being corrected, whatever words it uses.
 */
export const HOST_ANSWER_HINT: Record<Exclude<HostAnswer, 'answered'>, string> = {
  unasked: 'not checked yet',
  unreachable: 'could not reach the host',
};

/**
 * The kind of a host failure — a rate limit is a THIRD state, never an outage.
 *
 * `2026-08-20-a-rate-limit-is-not-an-outage.md`: a spent budget is *partial,
 * temporary, and with a known end*; an unreachable host is none of those. The
 * note that reports the failure must not collapse the two into one word, so it
 * reads the kind here first.
 *
 * The signal is the message string, `/rate limit/i` — the SAME string the
 * backend keys on (`rateLimitBackoffMs` in fleet.ts). A shelled-out `gh` hands
 * back only its stderr, so both ends read the same words; a second, cleverer
 * detector on the client would be the place the two vocabularies drift, and the
 * note would say *outage* while the fetch was already backing off for a rate
 * limit. Anything the backend does NOT recognise as a rate limit is an outage
 * here too — the honest default, since a message that names no reset has no end
 * to promise.
 */
export type HostErrorState = 'rate-limited' | 'unreachable';

export function hostErrorState(error: string | null): HostErrorState | null {
  if (!error) return null;
  return /rate limit/i.test(error) ? 'rate-limited' : 'unreachable';
}

/**
 * When the spent budget returns, in the reader's words — or null when no reset
 * is known.
 *
 * `prNextInSeconds` is the reset the fetch already waits for: *backoff
 * included*, per the contract, which after the sibling wave is the host's real
 * `rate_limit` reset rather than the nominal cadence. Rounded to the minute
 * above a minute, because the wait is minute-scale and second-precision would
 * flicker every render; kept in seconds below that, where a minute would read
 * as *0 min*. Null (an older server, or a due-now gate at 0) yields no phrase,
 * so the note says the budget is spent without inventing a time it cannot name.
 */
function resetPhrase(prNextInSeconds: number | null): string | null {
  if (prNextInSeconds === null || prNextInSeconds <= 0) return null;
  if (prNextInSeconds < 60) return `${prNextInSeconds}s`;
  return `${Math.round(prNextInSeconds / 60)} min`;
}

/**
 * Human-readable phrase for data age, using the same format as the reset.
 *
 * Rounded to the minute above a minute, kept in seconds below — the same rule
 * `resetPhrase` follows, so "14 min" and "~14 min" look like the same clock.
 * Null yields nothing, so the sentence omits what it cannot name.
 */
function agePhrase(ageSeconds: number | null): string | null {
  if (ageSeconds === null || ageSeconds <= 0) return null;
  if (ageSeconds < 60) return `${ageSeconds}s`;
  return `${Math.round(ageSeconds / 60)} min`;
}

/**
 * The PR footer note — one sentence, or null when the host answered.
 *
 * TWO shapes for TWO failures, which is the whole branch. An unreachable host
 * keeps the exact wording `an-outage-is-not-an-answer` settled — *PR data
 * unavailable (…) — the two groups above that depend on it may be incomplete.*
 * A rate limit is not unavailable: it says so, and names when service returns.
 *
 * THE BANNER NAMES THE AGE of the data still on screen (Done-when item 10).
 * The catch keeps the last good map rather than blanking it — a deliberate
 * choice — which leaves the reader looking at data of unknown age. The age
 * phrase turns "something is wrong" into "showing data from 14 min ago".
 *
 * Exported for test — the wording is the contract with the reader.
 */
export function prNote(fleet: Pick<Fleet, 'prError' | 'prNextInSeconds' | 'prAgeSeconds'>): string | null {
  const kind = hostErrorState(fleet.prError);
  if (kind === null) return null;
  const age = agePhrase(fleet.prAgeSeconds);
  const ageSuffix = age ? ` — showing data from ${age} ago` : '';
  if (kind === 'rate-limited') {
    const when = resetPhrase(fleet.prNextInSeconds);
    return (
      "PR data paused: the host's rate limit is spent" +
      (when ? `, service returns in ~${when}` : '') +
      ageSuffix +
      ' — the two groups above that depend on it may be incomplete.'
    );
  }
  // Keep the full error message — it names the failing script/path, which is
  // what a reader needs to diagnose the failure. The test `shows the WHOLE PR
  // error, however long the path in it` asserts this contract.
  return `PR data unavailable (${fleet.prError})${ageSuffix} — the two groups above that depend on it may be incomplete.`;
}

/**
 * The issue footer note — one sentence, or null when the tracker answered.
 *
 * The rate-limit case is the sharpest test the plan names: a spent budget means
 * the tracker was REFUSED, not that reading it failed. *could not be read*
 * claims a check that ran and failed, and a rate limit ran no check — so it
 * must not borrow that wording. The issue poll shares the PR gate (`prNextAt`),
 * so `prNextInSeconds` is its reset too.
 */
export function issueNote(fleet: Pick<Fleet, 'issueError' | 'prNextInSeconds'>): string | null {
  const kind = hostErrorState(fleet.issueError);
  if (kind === null) return null;
  if (kind === 'rate-limited') {
    const when = resetPhrase(fleet.prNextInSeconds);
    return (
      "Open issues paused: the tracker's rate limit is spent" +
      (when ? `, service returns in ~${when}` : '') +
      ' — this list may be incomplete.'
    );
  }
  return `Open issues could not be read, so this list may be incomplete — ${fleet.issueError}`;
}

/**
 * THE SCAN'S OWN HOST VERDICT — a different fact from `prError`, one level up.
 *
 * `prError` is the BOARD's host call failing (`refreshPrs` in `fleet.ts`).
 * This is the SCAN's: `plot-fleet-scan.sh` shells out to `plot-host.sh
 * pr-list`, and when that call is refused the scan reports `host=throttled` on
 * its summary rather than swallowing the failure. The two fail separately and
 * can be true separately, so they are read separately — the board can hold
 * fresh PR data of its own while the scan that produced the rows was blind.
 *
 * Why this needs saying at all: `pr-list` is ONE GraphQL call in place of ~186
 * REST calls, so a spent budget takes out EVERY PR answer at once rather than
 * degrading row by row. The fleet then reads unmerged, every wave stays
 * blocked, and the board shows a busy estate with nothing eligible —
 * indistinguishable from work genuinely in flight. Measured 2026-08-29: three
 * merged branches read as unlanded while GraphQL was refusing.
 *
 * `unknown` renders NOTHING, the same rule `prStateWord` follows. A pulse from
 * an older scan, a partial pulse mid-stream, and a cold cache all report
 * `unknown` — none of them has been told anything about the host, and a notice
 * on that basis would be the board inventing a fact.
 */
export type ScanHostVerdict = Fleet['summary']['host'];

/**
 * The scan-host note — one sentence, or null when the scan's host answered.
 *
 * TWO WORDS, TWO SENTENCES, because they need different responses: a spent
 * budget refills on a clock and the reader should wait, an unreachable host
 * will not clear by waiting and the reader should look. Collapsing them into
 * one *host problem* sentence sends half of readers to the wrong errand — the
 * distinction the scan went to the trouble of drawing, thrown away at the last
 * step.
 *
 * BOTH NAME THE CONSEQUENCE, not just the cause. "The host was throttled" is a
 * fact about an API; what a reader actually needs is why the board looks quiet
 * — every branch read from local evidence alone, so nothing was offered to
 * `--next`. That sentence turns an unexplained empty board into an explained
 * one, which is the whole point of the plan.
 *
 * Exported for test — the wording is the contract with the reader.
 */
export function scanHostNote(
  fleet: Pick<Fleet, 'summary'>,
): string | null {
  // `summary` is CAST rather than parsed on the client, so a payload from a
  // server that predates the field arrives as `undefined` here — the
  // `fleetControls` lesson from 2026-08-22, which a Zod `.default()` does not
  // save because it fires only at parse time. Guarded rather than assumed.
  const host = fleet.summary?.host;
  if (host === 'throttled') {
    return "Fleet scan blind: the git host's rate limit was spent, so no PR could be read."
      + ' Every branch below reads from local evidence alone and none was offered to'
      + ' --next — the budget refills on a clock, so a later scan will say more.';
  }
  if (host === 'failed') {
    return 'Fleet scan blind: the git host could not be reached, so no PR could be read.'
      + ' Every branch below reads from local evidence alone and none was offered to'
      + ' --next. This is not a rate limit — waiting will not clear it; check the host'
      + ' and auth.';
  }
  return null;
}

/**
 * The PR a row carries, derived from the row rather than imported.
 *
 * `AgentRowSchema` names the shape inline, so there is no exported alias to
 * import — and adding one is a change to the contract, which this wave is
 * deliberately not making. Derived, so it cannot drift from the field it
 * describes: a seventh state or a new flag arrives here without an edit.
 */
type AgentPr = NonNullable<AgentRow['pr']>;

/**
 * The PR's condition as a WORD, for the cell to print beside the number.
 *
 * The repo's rule is *symbol AND word* — colour or shape must never be the sole
 * carrier — so the state is spelled out however the cell decorates it. Six
 * values, six phrasings, and each says what the reader would have to do:
 * `conflicts` wants a rebase, `no checks` wants a click, `failing` wants
 * reading.
 *
 * `unknown` renders NOTHING rather than the word "unknown". A host that cannot
 * report a rollup (Bitbucket) would otherwise stamp every row with a word that
 * says only *this board could not find out* — noise on every line of an
 * entire host's fleet. Absent is the honest rendering of "no answer", the same
 * rule the contract states for the field itself.
 *
 * Exported for test.
 */
export function prStateWord(state: AgentPr['state']): string {
  switch (state) {
    case 'green': return 'green';
    case 'pending': return 'CI running';
    case 'failing': return 'checks failing';
    case 'none': return 'no checks';
    case 'conflicts': return 'conflicts';
    default: return '';
  }
}

/**
 * The note, with the PR clause the CELL now renders taken off the front.
 *
 * The server still composes `PR #158, draft · awaiting review` — that sentence
 * is `fleet.ts`'s, and this wave does not touch it. But the PR's number, its
 * draft flag and its state now travel as fields and are rendered by their own
 * cell, so printing the whole sentence beside that cell would say the same
 * thing twice on every row that has a PR.
 *
 * **This is deliberately NOT the `indexOf` search it replaces.** That one
 * hunted a marker ANYWHERE in a sentence in order to LINK it — a parser for a
 * format nobody declared, which silently rendered an unlinked note the moment
 * the wording drifted. This one is anchored at position 0, matches only the
 * row's OWN number, and its failure mode is the opposite: a note whose wording
 * drifts is printed in full, which is a duplicated word rather than a lost
 * link. Nothing depends on it — the PR cell renders from the fields either way.
 *
 * **Everything after the separator survives**, because that is what a PR state
 * cannot say: *uncommitted work*, *blocked by an earlier wave*, *claimed
 * elsewhere*, *awaiting review*. The note is not being replaced, only relieved
 * of one duty.
 *
 * Exported for test — an implementation that drops the whole note passes every
 * "the row no longer says PR #130 twice" assertion.
 */
export function noteWithoutPr(note: string, pr: AgentRow['pr']): string {
  if (!pr) return note;
  const marker = `PR #${pr.number}`;
  if (!note.startsWith(marker)) return note;
  const rest = note.slice(marker.length);
  // The separator the server writes between the PR clause and everything else.
  // Anything before it is the PR's own condition, which the cell now carries.
  const at = rest.indexOf(' · ');
  return at === -1 ? '' : rest.slice(at + 3);
}
