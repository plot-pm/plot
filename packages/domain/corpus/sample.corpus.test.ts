import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { idleNow, type CommitReading, type DeskReading, type PidStatus } from '../src/rules/sample.js';
import type { WorkerActivity } from '../src/entities/fleet.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE THIRD RULE-VERSUS-SHELL COMPARISON: does `idleNow` answer what
 * `plot-worker-state.sh`'s `plot_worker_idle_now` answers, over every
 * combination of the six readings it takes?
 *
 * THE PAIR EXISTS ON PURPOSE. `docs/shell-and-domain.md` §1 settles which side
 * of the cost rule this falls on: the rule is asked once per agent per pass, so
 * a 39 ms bundle hop would be paid by every agent on the machine forever. The
 * shell holds its own copy and this holds the pair. NEITHER SIDE IS
 * AUTHORITATIVE — on a disagreement the branch stops, and adjusting either side
 * to make this pass is the one move forbidden.
 *
 * THE CORPUS IS CONSTRUCTED, AND EXHAUSTIVELY. A desk corpus has to be built
 * because CI's checkout has one clean worktree (`desk-reset.corpus.test.ts`
 * says so); this corpus needs no desk at all, because the rule is a function of
 * six values. So every combination is enumerated rather than sampled — the
 * cross product is small enough to run whole, and a sampled corpus would be a
 * comparison whose coverage depends on a seed.
 *
 * THE BOUNDARY VALUES ARE IN THE PRODUCT, not a separate case, because that is
 * where a `>` written for a `>=` hides and where the two languages could most
 * easily disagree: the shell compares with `-ge` over digits and the rule with
 * `>=` over a `number`.
 *
 * THE `''` ACTIVITY WORD IS IN THE PRODUCT TOO, and it is the one the rule and
 * the OLD rule read oppositely. `observe()` in `sample.ts` reads `''` as *not
 * quiet* — the absence of a child was not the presence of an idle one, under a
 * CPU snapshot. `idleNow` reads it as *no veto*, because this line is reached
 * only after the window has elapsed. A corpus sending only `working` and `idle`
 * would never exercise the case a reimplementation gets wrong.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;

/**
 * The pair this file compares, and the words its report uses.
 *
 * Two implementations of one rule, so neither is `adapter=` and neither is
 * `production=` — the reader has to be sent to the right file.
 */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

/** The window every case is judged against — the shipped default. */
const WINDOW = 900;

/** One case: the six readings, and a name a failure can be read by. */
interface Case {
  name: string;
  reading: DeskReading;
  /** The sampler's own word, which the reading carries as a boolean. */
  activity: WorkerActivity;
}

/**
 * Every combination of the six readings.
 *
 * THE DURATIONS CARRY FOUR VALUES EACH and the unreadable one is a WORD rather
 * than a number, because that is how it arrives in the shell: `unavailable`
 * from the transcript reader and `unreadable` from the tree reader. The rule
 * takes a `number`, so the caller translates — and `NaN` is the translation
 * that caught a real defect, so it is the one sent here.
 */
const PIDS: PidStatus[] = ['alive', 'dead', 'unrecorded'];
const SPOKEN = [true, false];
const ACTIVITIES: WorkerActivity[] = ['working', 'idle', ''];
const COMMITS: CommitReading[] = ['yes', 'no', 'unanswerable'];
/** `window - 1`, the window itself, far past it, and no reading at all. */
const DURATIONS: Array<[label: string, shell: string, rule: number]> = [
  ['inside', String(WINDOW - 1), WINDOW - 1],
  ['at', String(WINDOW), WINDOW],
  ['past', '99999', 99_999],
  ['unreadable', 'unreadable', Number.NaN],
];

const cases: Case[] = [];
for (const pid of PIDS) {
  for (const spoken of SPOKEN) {
    for (const [silLabel, , silRule] of DURATIONS) {
      for (const activity of ACTIVITIES) {
        for (const [treeLabel, , treeRule] of DURATIONS) {
          for (const commits of COMMITS) {
            cases.push({
              name: `${pid}/${spoken ? 'spoken' : 'unspoken'}/sil-${silLabel}/` +
                `cpu-${activity === '' ? 'none' : activity}/tree-${treeLabel}/${commits}`,
              activity,
              reading: {
                pid,
                spoken,
                silenceSeconds: silRule,
                // THE VETO IS A BOOLEAN AND ONLY `working` SETS IT. Both `idle`
                // and `''` are false, which is how `sample_verdict` reads them
                // and is NOT how `observe` reads `''`.
                childOnCore: activity === 'working',
                treeQuietSeconds: treeRule,
                commits,
              },
            });
          }
        }
      }
    }
  }
}

/** The shell word for a duration, recovered from the rule's number. */
const shellDuration = (rule: number): string =>
  DURATIONS.find(([, , n]) => (Number.isNaN(n) ? Number.isNaN(rule) : n === rule))![1];

/**
 * Every case's verdict from the SHIPPED shell function, in one bash process.
 *
 * ONE PROCESS FOR THE WHOLE CORPUS, not one per case. 864 cases at a ~40 ms
 * bash start would be 35 seconds of forking to compare a pure function; the
 * function is sourced once and called in a loop, which is also how the monitor
 * calls it. The readings go in on stdin so no argument list can overflow.
 */
const shellVerdicts = (all: readonly Case[]): string[] => {
  const stdin = all
    .map((one) => [
      one.reading.pid,
      one.reading.spoken ? '1' : '0',
      shellDuration(one.reading.silenceSeconds),
      // An empty activity word must survive the wire, so the empty string is
      // sent as a placeholder the reader turns back into ''.
      one.activity === '' ? '-' : one.activity,
      shellDuration(one.reading.treeQuietSeconds),
      one.reading.commits,
    ].join('\t'))
    // A TRAILING NEWLINE, AND IT IS LOAD-BEARING. `read` returns non-zero at
    // EOF without a delimiter even though it has populated the variables, so a
    // `while read` loop DISCARDS the last record of input that does not end in
    // one. Measured 2026-10-02: the corpus reported exactly one disagreement,
    // `rule="silent" shell=""`, on its 864th case — the shell had never been
    // asked. POSIX text is newline-terminated, so terminating it keeps the loop
    // the plain shape the monitor's own call has.
    .join('\n') + '\n';

  const script = `
    . ${JSON.stringify(STATE_LIB)}
    while IFS="$(printf '\\t')" read -r pid spoken sil cpu tree commits; do
      [ -n "$pid" ] || continue
      [ "$cpu" = '-' ] && cpu=''
      plot_worker_idle_now "$pid" "$spoken" "$sil" "$cpu" "$tree" "$commits" ${WINDOW}
      printf '\\n'
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  // EVERY LINE IS READ AND NONE IS PADDED. A `slice(0, n)` over a short answer
  // silently supplies empty strings, which then compare as a disagreement whose
  // cause is the harness rather than either side — the shape that cost this
  // file its first red run. The count is asserted below instead.
  const words = out.split('\n');
  if (words[words.length - 1] === '') words.pop();
  return words;
};

const shell = shellVerdicts(cases);

describe('idleNow agrees with plot-worker-state.sh plot_worker_idle_now', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR, because the comparison below is universally quantified and a
    // universal claim over an empty set is true. The product is
    // 3 × 2 × 4 × 3 × 4 × 3 = 864, and the floor is stated as a number rather
    // than recomputed from the arrays — a bug that emptied one array would
    // otherwise satisfy a derived floor.
    expect(cases.length).toBe(864);
    expect(cases.length).toBeGreaterThan(100);
    expect(shell.length).toBe(cases.length);
    expect(shell.every((word) => word === 'idle' || word === 'silent')).toBe(true);
  });

  it('exercises both answers, so this is not vacuous', () => {
    // If the corpus only ever produced `silent`, agreement would be an accident
    // of the construction rather than a property of the pair — and `silent` is
    // what every wrong rule answers most of the time.
    const ruled = new Set(cases.map((one) => idleNow(one.reading, WINDOW)));
    expect([...ruled].sort()).toEqual(['idle', 'silent']);
    expect(new Set(shell).size).toBe(2);

    // And each reading must vary, or one question is being asked repeatedly.
    expect(cases.some((one) => one.reading.pid === 'alive')).toBe(true);
    expect(cases.some((one) => one.reading.pid === 'dead')).toBe(true);
    expect(cases.some((one) => one.reading.pid === 'unrecorded')).toBe(true);
    expect(cases.some((one) => !one.reading.spoken)).toBe(true);
    expect(cases.some((one) => one.activity === '')).toBe(true);
    expect(cases.some((one) => one.activity === 'working')).toBe(true);
    expect(cases.some((one) => one.reading.commits === 'unanswerable')).toBe(true);
    expect(cases.some((one) => Number.isNaN(one.reading.silenceSeconds))).toBe(true);
    expect(cases.some((one) => Number.isNaN(one.reading.treeQuietSeconds))).toBe(true);
    // The boundary itself, on both sides, for both durations.
    expect(cases.some((one) => one.reading.silenceSeconds === WINDOW)).toBe(true);
    expect(cases.some((one) => one.reading.silenceSeconds === WINDOW - 1)).toBe(true);
    expect(cases.some((one) => one.reading.treeQuietSeconds === WINDOW)).toBe(true);
    expect(cases.some((one) => one.reading.treeQuietSeconds === WINDOW - 1)).toBe(true);
  });

  it('answers what the shell answers, on every combination', () => {
    const found: Disagreement[] = [];
    cases.forEach((one, i) => {
      compareField(found, one.name, 'idle-now', idleNow(one.reading, WINDOW), shell[i]);
    });
    // ONE comparison rather than an assertion per case: one case disagreeing
    // and every case disagreeing are different findings pointing at different
    // bugs, and a failure has to name which.
    expect(found.map(report)).toEqual([]);
  });

  it('agrees that the window itself is quiet, on both sides', () => {
    // THE BOUNDARY, asserted on the SHELL's answer too and not only on the
    // pair's agreement. Two implementations that both wrote `>` would agree
    // perfectly and both be wrong, which is the one failure a comparison cannot
    // see — so the value is pinned.
    const at = cases.findIndex((one) => one.name ===
      'alive/spoken/sil-at/cpu-none/tree-at/yes');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(shell[at]).toBe('idle');
    expect(idleNow(cases[at].reading, WINDOW)).toBe('idle');

    const inside = cases.findIndex((one) => one.name ===
      'alive/spoken/sil-inside/cpu-none/tree-at/yes');
    expect(shell[inside]).toBe('silent');
    expect(idleNow(cases[inside].reading, WINDOW)).toBe('silent');
  });

  it('agrees that no child on a core is no veto, on both sides', () => {
    // THE `''` WORD, pinned for the same reason. This is where `idleNow` and
    // `observe` read one sampler answer oppositely, so a reimplementation that
    // copied `observe` would answer `silent` here and the pair would disagree.
    const none = cases.findIndex((one) => one.name ===
      'alive/spoken/sil-past/cpu-none/tree-past/yes');
    expect(shell[none]).toBe('idle');
    expect(idleNow(cases[none].reading, WINDOW)).toBe('idle');

    const working = cases.findIndex((one) => one.name ===
      'alive/spoken/sil-past/cpu-working/tree-past/yes');
    expect(shell[working]).toBe('silent');
    expect(idleNow(cases[working].reading, WINDOW)).toBe('silent');
  });

  it('agrees that a dead pid is silent and never gone, on both sides', () => {
    // NO `gone` ARM on either side. The wrapper publishes `gone`, and a `gone`
    // leaking out of this rule would reach a findings file as a restart request
    // for an agent that exited cleanly.
    const dead = cases.filter((one) => one.reading.pid === 'dead');
    expect(dead.every((one) => idleNow(one.reading, WINDOW) === 'silent')).toBe(true);
    const deadShell = cases
      .map((one, i) => [one, shell[i]] as const)
      .filter(([one]) => one.reading.pid === 'dead')
      .map(([, word]) => word);
    expect([...new Set(deadShell)]).toEqual(['silent']);
  });

  it('reports a disagreement naming the subject and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    const line = report({
      subject: 'alive/spoken/sil-at/cpu-none/tree-at/yes',
      field: 'idle-now',
      adapter: 'idle',
      production: 'silent',
    });
    expect(line).toBe(
      'alive/spoken/sil-at/cpu-none/tree-at/yes :: idle-now :: rule=idle shell=silent',
    );
  });
});
