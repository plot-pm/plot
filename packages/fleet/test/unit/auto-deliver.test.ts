// A finished plan delivers itself, and its desks are cleared behind it.
//
// The wave's `Done when` items 3, 4, 5, 6, 7 and 10, and the ones that exist
// BECAUSE A NAIVE IMPLEMENTATION WOULD PASS WITHOUT THEM are the reason most of
// this file is here:
//
//   item 4  — the reap runs AFTER the delivery, asserted AS ORDERING. Both
//             orders end with a delivered plan and no worktree, so an end-state
//             assertion passes either way. Only the sequence discriminates, so
//             both stubs append to ONE marker and the file's order is the test.
//   item 5  — a plan whose remaining waves are all `deferred` is NOT delivered.
//   item 6  — nothing is delivered while any non-deferred wave is unmerged.
//   item 7  — the board writes no phase and no `Delivered:` record. Asserted by
//             ABSENCE, in `no-board-phase-write.test.ts` beside this file.
//   item 10 — a `Deliver command` routes through an agent; its absence routes
//             direct. BOTH paths asserted.
//
// It never runs the real scripts: stub `plot-deliver.sh` and `plot-reap.sh`
// record their arguments to a marker file and exit, so no plan is written, no
// phase flipped and no worktree removed. The detached spawns are settled for
// with a short wait.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree as rmTree } from '../rm-tree.mjs';
import { planSlug, planAutoDeliver, pruneDelivering } from '@plot-pm/domain';
import { maybeAutoDeliver, runAutoDeliverPass, DELIVER_COMMAND_KEY } from '../../src/shared/auto-deliver.js';
import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import { allSlicesMerged } from '@plot-pm/domain';
import {
  readInFlight,
  inFlightPath,
  IN_FLIGHT_DELIVER_TTL_MS,
  IN_FLIGHT_PASS_GAP_MS,
  IN_FLIGHT_RENEW_AFTER_MS,
} from '../../src/shared/in-flight-store.js';
import { FLEET_SCAN_BUDGET_MS } from '../../src/shared/fleet-scan.js';
import { deliverLogPath } from '../../src/shared/action-log.js';
import { AUTO_DELIVER_MAX_FAILURES, retryDelayMs } from '@plot-pm/domain';
import type { Scripts, StartOptions } from '@plot-pm/domain/ports/scripts';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/**
 * A scratch repo plus a stub scripts dir.
 *
 * Both stubs append to ONE marker, prefixed with which ran — that single file is
 * what makes item 4 assertable. `plot-config.sh` is stubbed too, because
 * `deliverCommand` reads `Deliver command` through it; `deliverConfig` decides
 * what it answers, which is how the two entrances of item 10 are selected.
 */
function fixture(deliverCommand = '', deliverExit = 0) {
  return fixtureWithMarker(() => deliverCommand, deliverExit);
}

/**
 * The same fixture, for a command that needs to know where the marker is.
 *
 * The agent case must write to the file this fixture reads back, and it cannot
 * be told through the environment — see the note at that test. So the command
 * is BUILT from the marker path instead, which is known here and nowhere
 * earlier.
 */
function fixtureWithMarker(
  buildCommand: (marker: string) => string,
  deliverExit = 0,
): {
  opts: { repoRoot: string; scriptsDir: string };
  runs: () => string[];
} {
  // Nested one level down: the board writes a repo's agent logs into its parent.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autodel-repo-'));
  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
  const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autodel-scripts-'));
  made.push(parent, scriptsDir);

  const marker = path.join(scriptsDir, 'ran.txt');
  const deliverCommand = buildCommand(marker);

  // `readConfig` shells out to plot-config.sh: `get <key> <fallback>`. Answer
  // the deliver key with whatever this fixture is testing, and echo the
  // fallback for every other key so nothing else is disturbed.
  //
  // The command is emitted from a QUOTED heredoc, and that quoting is the whole
  // correctness of this stub rather than a style choice. Interpolating it as a
  // double-quoted bash string — which is what `JSON.stringify` produces — hands
  // the value to bash's expander before it is ever printed, so a `"$1"` in the
  // configured command becomes plot-config.sh's OWN first argument. Measured:
  // the agent case read back `agent get`, `get` being `readConfig`'s verb,
  // because the slug placeholder had been substituted away at config-read time.
  // A configured command is DATA here, and `<<'EOF'` is the only form that says
  // so.
  fs.writeFileSync(
    path.join(scriptsDir, 'plot-config.sh'),
    `#!/usr/bin/env bash\n` +
      `if [ "$2" = ${JSON.stringify(DELIVER_COMMAND_KEY)} ]; then\n` +
      `cat <<'PLOT_DELIVER_CMD_EOF'\n${deliverCommand}\nPLOT_DELIVER_CMD_EOF\n` +
      `else printf '%s\\n' "\${3:-}"; fi\n`,
    { mode: 0o755 },
  );

  // The delivery. Records that it ran and with what, then exits with the code
  // this fixture was built for — a non-zero exit is how "the delivery refused"
  // is expressed, and it is what must stop the reap.
  fs.writeFileSync(
    path.join(scriptsDir, 'plot-deliver.sh'),
    `#!/usr/bin/env bash\nprintf 'deliver %s\\n' "$*" >> ${JSON.stringify(marker)}\n` +
      // A beat, so a reap fired BESIDE the delivery rather than after it would
      // land first and be caught. Without it both orders can look alike.
      `sleep 0.15\nexit ${deliverExit}\n`,
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(scriptsDir, 'plot-reap.sh'),
    `#!/usr/bin/env bash\nprintf 'reap %s\\n' "$*" >> ${JSON.stringify(marker)}\n` +
      // The same beat, for the same reason one link further down: a ref release
      // fired BESIDE the reap rather than after it would otherwise be able to
      // land first, and the marker could not tell the two orders apart.
      `sleep 0.15\n`,
    { mode: 0o755 },
  );

  // The ref release — the third link, and the one this wave adds. It records
  // its arguments because the SLUG is load-bearing here in a way it is not for
  // the reap: this script is plan-scoped, and a call that dropped the slug
  // would be asking it to act on the wrong set of branches.
  fs.writeFileSync(
    path.join(scriptsDir, 'plot-release-refs.sh'),
    `#!/usr/bin/env bash\nprintf 'release %s\\n' "$*" >> ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );

  return {
    opts: { repoRoot, scriptsDir },
    runs: () =>
      fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [],
  };
}

/**
 * Long enough for a delivery, the reap chained to its exit, AND the ref release
 * chained to the reap's.
 *
 * THREE spawns in SEQUENCE, not one: each starts only when the previous one's
 * `exit` fires, so this must cover three process startups plus two stub
 * `sleep 0.15`s. At 700 ms it was under-budgeted for two links and the reap
 * assertions read an empty marker — which looks exactly like the ordering being
 * broken, rather than like a wait that ended too early. Raised from 2500 ms
 * when the third link was added, for the same reason.
 */
const settle = (ms = 4000) => new Promise((r) => setTimeout(r, ms));

// THE VERDICT IS DERIVED, NOT DECLARED. It was hardcoded 'complete' for every
// wave, including ones holding an open branch — a shape the real scan cannot
// emit: plot-fleet-scan.sh sets complete only when outstanding -eq 0.
//
// That inconsistency was invisible while allSlicesMerged re-walked the branch
// states, because it never read the field. Since #491 it reads the VERDICT (the
// scan already computed this, and two derivations of one question is the
// duplication this repo keeps removing), so a fixture claiming complete over an
// unmerged branch now asserts the opposite of what its test means — it turned
// ITEM 6, the gate that delivers NOTHING while a wave is unmerged, green-to-red.
//
// Deriving it keeps every fixture honest by construction: a test states its
// branches and cannot contradict itself in a field it never thought about.
const slice = (
  name: string,
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict: branches.every(([, st]) => st === 'merged' || st === 'deferred')
    ? ('complete' as const)
    : ('eligible' as const),
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
    ref_held: false,
  })),
});

const pulse = (plans: Array<[string, string, ReturnType<typeof slice>[]]>): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, slices]) => ({ file, phase, slices })),
    summary: {
      plans: plans.length, waves: 0, branches: 0,
      claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    },
  });

/** An approved plan whose single wave has merged — the deliverable case. */
const finished = (file = '2026-08-27-ship-it.md') =>
  pulse([[file, 'approved', [slice('W', [['feature/a', 'merged']])]]]);

describe('planAutoDeliver — the decision, and it is pure', () => {
  it('names an approved plan whose every non-deferred wave has merged', () => {
    const plans = planAutoDeliver({ pulse: finished(), inFlight: new Set() });
    expect(plans).toEqual([{ slug: 'ship-it', file: '2026-08-27-ship-it.md' }]);
  });

  // ITEM 6. The gate /plot-deliver applies by hand, applied here. An
  // auto-deliverer that skips it ships the exact refusal Plot exists to enforce.
  it('ITEM 6: delivers NOTHING while a non-deferred wave is unmerged', () => {
    const p = pulse([
      ['2026-08-27-ship-it.md', 'approved', [
        slice('One', [['feature/a', 'merged']]),
        slice('Two', [['feature/b', 'open']]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  // ITEM 5. Shelved is not finished. A plan holding merged AND deferred waves IS
  // deliverable (the deferred ones are exempt), but one whose branches are ALL
  // deferred has no landed work to testify to.
  it('ITEM 5: a plan whose remaining waves are ALL deferred is not delivered', () => {
    const p = pulse([
      ['2026-08-27-shelved.md', 'approved', [
        slice('One', [['feature/a', 'deferred']]),
        slice('Two', [['feature/b', 'deferred']]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  it('ITEM 5, the other side: merged BESIDE deferred still delivers', () => {
    // The distinction item 5 rests on — deferred branches are exempt, so a plan
    // is not held back by them; it is held back by having nothing merged at all.
    // A fix for item 5 that simply refused every plan containing a deferred
    // branch would pass the test above and fail this one.
    const p = pulse([
      ['2026-08-27-mixed.md', 'approved', [
        slice('One', [['feature/a', 'merged']]),
        slice('Two', [['feature/b', 'deferred']]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() }).map((x) => x.slug)).toEqual(['mixed']);
  });

  it('refuses a plan that is not approved — draft, delivered and released alike', () => {
    for (const phase of ['draft', 'delivered', 'released']) {
      const p = pulse([['2026-08-27-ship-it.md', phase, [slice('W', [['feature/a', 'merged']])]]]);
      expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
    }
  });

  it('refuses a plan with no branches at all', () => {
    const p = pulse([['2026-08-27-empty.md', 'approved', [slice('W', [])]]]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  it('skips a plan whose delivery is already in flight', () => {
    const plans = planAutoDeliver({ pulse: finished(), inFlight: new Set(['ship-it']) });
    expect(plans).toEqual([]);
  });

  it('delivers nothing at all from a pulse that never landed', () => {
    expect(planAutoDeliver({ pulse: null, inFlight: new Set() })).toEqual([]);
  });
});

describe('pruneDelivering — retiring what the pulse has confirmed', () => {
  it('keeps a slug whose plan still reads approved and still measures finished', () => {
    expect([...pruneDelivering(new Set(['ship-it']), finished())]).toEqual(['ship-it']);
  });

  it('retires a slug once its plan has moved to delivered', () => {
    const p = pulse([['2026-08-27-ship-it.md', 'delivered', [slice('W', [['feature/a', 'merged']])]]]);
    expect([...pruneDelivering(new Set(['ship-it']), p)]).toEqual([]);
  });

  it('holds the set unchanged across a pulse that never landed', () => {
    // "Nothing said" is not "confirmed" — retiring here would let the next
    // successful pulse start a second delivery for a plan already being
    // delivered.
    expect([...pruneDelivering(new Set(['ship-it']), null)]).toEqual(['ship-it']);
  });
});

describe('planSlug', () => {
  it('strips the date prefix and the .md suffix, as plot-deliver.sh resolves it', () => {
    expect(planSlug('docs/plans/2026-08-27-ship-it.md')).toBe('ship-it');
    expect(planSlug('2026-08-27-a-finished-plan-delivers-itself.md'))
      .toBe('a-finished-plan-delivers-itself');
  });
});

describe('maybeAutoDeliver — the act', () => {
  // ITEM 10, the DIRECT entrance: no `Deliver command`, so the board runs the
  // script Plot ships and passes it the slug.
  it('ITEM 10 (direct): with no Deliver command it runs plot-deliver.sh with the slug', async () => {
    const { opts, runs } = fixture('');
    const next = maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    expect(runs()[0]).toBe('deliver ship-it');
    expect([...next]).toEqual(['ship-it']);
  });

  // ITEM 10, the AGENT entrance: a `Deliver command` is a shell fragment, and
  // the prompt reaches it as ONE argument via "$@" rather than interpolated.
  it('ITEM 10 (agent): a Deliver command is run, and gets /plot-deliver <slug>', async () => {
    // The command records to the same marker, so the assertion is the same
    // shape as the direct case — and asserting the WHOLE line is the point:
    // the slug must arrive as ONE argument, appended by the `"$@"` wrapper
    // rather than interpolated into the command string.
    //
    // The marker path is baked into the command rather than passed through the
    // environment. An env var would have to survive `readConfig`'s bash, the
    // wrapper's `sh -c` and the spawn's own env — three chances to be lost or
    // expanded early, none of them what this test is about.
    const { opts, runs } = fixtureWithMarker((marker) =>
      `sh -c 'printf "agent %s\\n" "$1" >> ${JSON.stringify(marker)}' _`);
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    // The FIRST line, not the whole file. This agent command exits 0, so item
    // 4's ordering applies to this entrance too and the reap appends behind it —
    // asserting the whole file here would make a passing item 4 fail item 10.
    expect(runs()[0]).toBe('agent /plot-deliver ship-it');
  });

  // ITEM 4 AGAIN, through the OTHER entrance. The ordering is a property of the
  // wire, not of the direct path that happens to be this repo's default, and a
  // chain hung only off the script branch would pass every test above.
  it('ITEM 4 (agent): the reap follows an agent delivery too', async () => {
    const { opts, runs } = fixtureWithMarker((marker) =>
      `sh -c 'printf "agent %s\\n" "$1" >> ${JSON.stringify(marker)}' _`);
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    expect(runs().map((l) => l.split(' ')[0])).toEqual(['agent', 'reap', 'release']);
  });

  // ITEMS 4 AND 14 — THE ORDERING, and the reason this whole fixture funnels
  // every stub into one file. All six orders of these three acts end with a
  // delivered plan, no worktree and no ref, so an end-state assertion passes
  // for any of them. Only this sequence never shows a desk-less `Approved`
  // plan mid-flight (item 4), and never leaves a worktree outliving the ref it
  // tracks (item 14).
  it('ITEMS 4 and 14: deliver, THEN reap, THEN release the refs', async () => {
    const { opts, runs } = fixture('');
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    const order = runs().map((l) => l.split(' ')[0]);
    expect(order).toEqual(['deliver', 'reap', 'release']);
  });

  // ITEM 14, pinned on its own. The test above would still pass if the release
  // were chained to the DELIVERY's exit rather than the reap's, whenever the
  // reap happened to finish first — a race that would pass in CI most days and
  // fail on a loaded machine. The reap stub sleeps, so a release racing it lands
  // first and this catches it.
  it('ITEM 14: the release waits for the reap, not merely for the delivery', async () => {
    const { opts, runs } = fixture('');
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    const lines = runs();
    const reapAt = lines.findIndex((l) => l.startsWith('reap'));
    const releaseAt = lines.findIndex((l) => l.startsWith('release'));
    expect(reapAt).toBeGreaterThanOrEqual(0);
    expect(releaseAt).toBeGreaterThan(reapAt);
  });

  // The release is PLAN-SCOPED, where the reap beside it is slug-blind, and
  // that asymmetry is the whole safety argument: a removed checkout is
  // re-creatable with `git worktree add`, a deleted ref is not. A release
  // called without its slug would act on branches belonging to plans nobody
  // delivered.
  it('ITEM 14: the release is told WHICH plan finished, and to act', async () => {
    const { opts, runs } = fixture('');
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    expect(runs().find((l) => l.startsWith('release'))).toBe('release --yes ship-it');
  });

  it('ITEM 4, and it reaps with --yes — without it the wire ends in a dry run', async () => {
    const { opts, runs } = fixture('');
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    expect(runs()[1]).toBe('reap --yes');
  });

  // The other half of the ordering: the reap is gated on the delivery's EXIT
  // CODE, not merely sequenced after it. plot-deliver.sh exits non-zero on every
  // refusal it owns, and reaping after a refusal would clear the desks of work
  // the delivery just declined to call finished.
  it('reaps NOTHING when the delivery refused', async () => {
    const { opts, runs } = fixture('', 1);
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    expect(runs()).toEqual(['deliver ship-it']);
    expect(runs().some((l) => l.startsWith('reap'))).toBe(false);
    // And the third link never fires either — it hangs off the reap, so a
    // refusal that stops the reap stops the ref deletion with it. That is the
    // chain doing what a chain is for: one gate protects everything behind it.
    expect(runs().some((l) => l.startsWith('release'))).toBe(false);
  });

  it('spawns nothing for a plan that is not deliverable', async () => {
    const { opts, runs } = fixture('');
    const p = pulse([['2026-08-27-ship-it.md', 'approved', [slice('W', [['feature/a', 'open']])]]]);
    const next = maybeAutoDeliver(opts, p, new Set());
    await settle();
    expect(runs()).toEqual([]);
    expect(next.size).toBe(0);
  });

  // The cross-pulse guard. The scan fires every few seconds and a delivery
  // pushes to the default branch; a second call handed the first's in-flight set
  // and the same still-approved pulse must spawn nothing.
  it('CROSS-PULSE: a delivery in flight is not started again next pulse', async () => {
    const { opts, runs } = fixture('');
    const p = finished();
    const first = maybeAutoDeliver(opts, p, new Set());
    await settle();
    const before = runs().length;
    const second = maybeAutoDeliver(opts, p, first);
    await settle();
    expect(runs().length).toBe(before);
    expect([...second]).toEqual(['ship-it']);
  });
});

describe('planAutoDeliver — shelved is not finished', () => {
  // THE ASYMMETRY THIS BLOCK EXISTS FOR. `allSlicesMerged` answers `merged`
  // for a plan whose every branch was given up — that is what
  // `work-given-up-is-not-work-never-done` changed, and it is right for the
  // board's Deliver control and for `/plot-deliver`, where a person decides.
  //
  // This actor is not a person. It runs on the scan's clock with no switch and
  // no cap, and chains delivery to a reap and then to a ref deletion that
  // cannot be undone. Measured 2026-09-22, before this gate existed: widening
  // the rule alone would have auto-delivered two approved plans on the next
  // tick, one carrying three corrections its delivery panel owed to a person.
  it('does not deliver a plan whose every branch was given up', () => {
    const p = pulse([['2026-09-22-shelved.md', 'approved', [
      slice('W', [['feature/a', 'deferred']]),
    ]]]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  it('does not deliver one whose branches were given up across several slices', () => {
    const p = pulse([['2026-09-22-shelved.md', 'approved', [
      slice('one', [['feature/a', 'deferred']]),
      slice('two', [['feature/b', 'deferred'], ['feature/c', 'deferred']]),
    ]]]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  // The gate is `landedBranches > 0`, not `no branch is deferred`. A plan that
  // merged something and gave up the rest HAS landed work here, and the scan
  // saw it merge — so the automatic path may take it.
  it('delivers a plan that merged one branch and gave up another', () => {
    const p = pulse([['2026-09-22-partly.md', 'approved', [
      slice('W', [['feature/a', 'merged'], ['feature/b', 'deferred']]),
    ]]]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([
      { slug: 'partly', file: '2026-09-22-partly.md' },
    ]);
  });

  // The rule and the gate disagree here BY DESIGN, and this pins that they do.
  // A reader who "fixes" the disagreement removes the protection.
  it('is stricter than the rule it calls', () => {
    const p = pulse([['2026-09-22-shelved.md', 'approved', [
      slice('W', [['feature/a', 'deferred']]),
    ]]]);
    expect(allSlicesMerged({ file: '2026-09-22-shelved.md' }, p, true)).toBe('merged');
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });
});

// A LANDING ONLY A MERGE SUBJECT PROVES DOES NOT AUTO-DELIVER.
//
// The measured defect, 2026-10-01 (#1139): on a Bitbucket estate under HTTP
// 429, a branch merged with its ref deleted is proven merged by the
// `Merged in <branch> (pull request #N)` commit on the default branch. That is
// enough for the wave gate — opening the next slice is reversible — and not
// enough for a delivery, which flips a phase, moves a symlink and on this path
// chains to a reap and a ref deletion.
//
// Without the skip, the round-2 skeptic executed the sticking: tick 1 starts
// `plot-deliver.sh`, which asks the host and refuses; `pruneDelivering` keeps
// the slug in `inFlight` while the plan still reads approved and merged; and
// four later ticks over the same pulse start none. No later tick delivers
// until the board restarts.
//
// EVERY PULSE HERE IS PARSED, NEVER A TYPED LITERAL, and that is the gate
// rather than a style: `BranchSchema` is a plain `z.object` and STRIPS a key it
// does not declare. A literal pulse would carry `evidence` into the rule
// whatever the schema says, so these tests would pass with the field
// undeclared and the skip would never fire in production. `pulse()` above
// calls `FleetReadingSchema.parse`, so a stripped field fails these.
describe('a landing only a merge subject proves', () => {
  /**
   * One slice whose branches carry an evidence word.
   *
   * The verdict is derived exactly as `slice` derives it: a subject-proven
   * branch IS `merged`, so its slice IS `complete`. That is the shape the scan
   * emits and the reason the refusal has to live in the confirmation rule — a
   * fixture that made such a slice incomplete would be testing a pulse the
   * scan never produces.
   */
  const subjectSlice = (
    name: string,
    branches: Array<[string, 'open' | 'merged' | 'deferred', 'subject' | undefined]>,
  ) => ({
    name,
    verdict: branches.every(([, st]) => st === 'merged' || st === 'deferred')
      ? ('complete' as const)
      : ('eligible' as const),
    branches: branches.map(([branch, state, evidence]) => ({
      branch,
      state,
      deferred: state === 'deferred',
      claimed: '',
      ref_held: false,
      ...(evidence === undefined ? {} : { evidence }),
    })),
  });

  /** An approved plan whose only branch a merge subject proved. */
  const subjectOnly = (file = '2026-10-01-throttled.md') =>
    pulse([[file, 'approved', [subjectSlice('W', [['feature/a', 'merged', 'subject']])]]]);

  /** The same plan, the host having confirmed the merge. */
  const confirmed = (file = '2026-10-01-throttled.md') =>
    pulse([[file, 'approved', [subjectSlice('W', [['feature/a', 'merged', undefined]])]]]);

  // THE FIELD SURVIVES THE PARSE. Asserted first and on its own, because every
  // assertion below is vacuous if it does not — a stripped field makes the rule
  // answer as `allSlicesMerged` does and each test would pass for the wrong
  // reason.
  it('carries the evidence word through FleetReadingSchema', () => {
    const p = subjectOnly();
    expect(p.plans[0].slices[0].branches[0].evidence).toBe('subject');
    expect(p.plans[0].slices[0].branches[0].state).toBe('merged');
    // And the slice still reads complete, which is what keeps the wave gate
    // unmoved and the next slice startable.
    expect(p.plans[0].slices[0].verdict).toBe('complete');
  });

  it('names no plan for delivery while only a subject proves it', () => {
    expect(planAutoDeliver({ pulse: subjectOnly(), inFlight: new Set() })).toEqual([]);
  });

  it('names the plan once the host has confirmed the merge', () => {
    expect(planAutoDeliver({ pulse: confirmed(), inFlight: new Set() })).toEqual([
      { slug: 'throttled', file: '2026-10-01-throttled.md' },
    ]);
  });

  it('names no plan when one branch of several is proved only by subject', () => {
    const p = pulse([
      ['2026-10-01-throttled.md', 'approved', [
        subjectSlice('One', [['feature/a', 'merged', undefined]]),
        subjectSlice('Two', [['feature/b', 'merged', 'subject']]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
  });

  // A DEFERRED BRANCH IS EXEMPT. Work given up is not work awaiting
  // confirmation, and holding a delivery for ever on one would be a second
  // defect wearing this fix's clothes.
  it('names the plan when only a deferred branch carries the word', () => {
    const p = pulse([
      ['2026-10-01-throttled.md', 'approved', [
        subjectSlice('One', [
          ['feature/a', 'merged', undefined],
          ['feature/b', 'deferred', 'subject'],
        ]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([
      { slug: 'throttled', file: '2026-10-01-throttled.md' },
    ]);
  });

  it('starts no delivery on a tick over a subject-only plan', async () => {
    const { opts, runs } = fixture('');
    const next = maybeAutoDeliver(opts, subjectOnly(), new Set());
    await settle();
    expect(runs()).toEqual([]);
    expect([...next]).toEqual([]);
  });

  // THE STICKING, ASSERTED AS ABSENCE. `inFlight` stays empty across five
  // ticks over the same pulse — so there is no entry for `pruneDelivering` to
  // hold and no state a restart would clear.
  it('keeps inFlight empty across five subject-only ticks', async () => {
    const { opts, runs } = fixture('');
    let inFlight = new Set<string>();
    for (let tick = 0; tick < 5; tick++) {
      inFlight = maybeAutoDeliver(opts, subjectOnly(), inFlight);
      await settle();
      inFlight = pruneDelivering(inFlight, subjectOnly());
      expect([...inFlight]).toEqual([]);
    }
    expect(runs()).toEqual([]);
  });

  // AND THE FIRST TICK AFTER THE HOST CONFIRMS DELIVERS. The wait is a wait,
  // not a refusal: nothing has to be reset, and no restart is needed.
  it('delivers on the first tick after the host confirms the merge', async () => {
    const { opts, runs } = fixture('');
    let inFlight = maybeAutoDeliver(opts, subjectOnly(), new Set());
    await settle();
    expect(runs()).toEqual([]);
    inFlight = maybeAutoDeliver(opts, confirmed(), inFlight);
    await settle();
    expect(runs()[0]).toBe('deliver throttled');
    expect([...inFlight]).toEqual(['throttled']);
  });

  // THE WAVE GATE IS UNMOVED BY THE SAME PULSE, which is what the whole fix
  // buys: the merged slice settles, the next slice opens, and only the
  // delivery waits.
  it('still reads the plan as merged for the wave gate', () => {
    const p = subjectOnly();
    expect(allSlicesMerged({ file: '2026-10-01-throttled.md' }, p, true)).toBe('merged');
  });
});

describe('runAutoDeliverPass — the marks persist', () => {
  it('writes the plan as a mark before the delivery runs, and a second pass starts nothing', async () => {
    const { opts, runs } = fixture('');
    const p = finished();
    runAutoDeliverPass(opts, p);
    const marks = readInFlight(opts.repoRoot, Date.now(), 'deliver');
    expect([...(marks.branches ?? [])]).toEqual(['ship-it']);
    await settle();
    const before = runs().length;
    runAutoDeliverPass(opts, p);
    await settle();
    expect(runs().length).toBe(before);
  });

  it('starts nothing when the mark file exists and cannot be read', async () => {
    const { opts, runs } = fixture('');
    fs.mkdirSync(path.dirname(inFlightPath(opts.repoRoot, 'deliver')), { recursive: true });
    fs.writeFileSync(inFlightPath(opts.repoRoot, 'deliver'), '{not json');
    runAutoDeliverPass(opts, finished());
    await settle();
    expect(runs()).toEqual([]);
  });

  // M1 of #1453. A delivery that exits non-zero leaves the pulse reading
  // approved + merged, so no pulse-driven rule can retire the mark: only the
  // exit can. Asserts the mark is gone and the plan is plannable again.
  it('retires the mark of a delivery that fails, so the next pass retries it', async () => {
    const { opts, runs } = fixture('', 1);
    const p = finished();
    runAutoDeliverPass(opts, p);
    expect([...(readInFlight(opts.repoRoot, Date.now(), 'deliver').branches ?? [])]).toEqual(['ship-it']);
    await settle();
    expect(runs()).toEqual(['deliver ship-it']);
    const after = readInFlight(opts.repoRoot, Date.now(), 'deliver');
    expect([...(after.branches ?? [])]).toEqual([]);
    expect(planAutoDeliver({ pulse: p, inFlight: after.branches ?? new Set() }).map((x) => x.slug)).toEqual(['ship-it']);
    // The retry waits for the delay after the first failure.
    runAutoDeliverPass(opts, p);
    await settle();
    expect(runs()).toEqual(['deliver ship-it']);
    runAutoDeliverPass(opts, p, (after.failures['ship-it']?.lastAt ?? 0) + retryDelayMs(1));
    await settle();
    expect(runs()).toEqual(['deliver ship-it', 'deliver ship-it']);
  });

  it('keeps the mark of a delivery that succeeds', async () => {
    const { opts } = fixture('', 0);
    runAutoDeliverPass(opts, finished());
    await settle();
    expect([...(readInFlight(opts.repoRoot, Date.now(), 'deliver').branches ?? [])]).toEqual(['ship-it']);
  });

  // L3 of #1453. The file's mtime is the observable: a rewrite changes it.
  it('writes the marks once across two passes that persist the same set', async () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    const p = finished();
    runAutoDeliverPass(opts, p);
    const first = fs.statSync(file);
    const firstBody = fs.readFileSync(file, 'utf8');
    await new Promise((r) => setTimeout(r, 25));
    runAutoDeliverPass(opts, p);
    const second = fs.statSync(file);
    expect(second.mtimeMs).toBe(first.mtimeMs);
    expect(second.ino).toBe(first.ino);
    expect(fs.readFileSync(file, 'utf8')).toBe(firstBody);
    await settle();
  });

  it('skips the write for an unchanged set while the mark is younger than the renewal age', async () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    runAutoDeliverPass(opts, finished('2026-08-27-ship-it.md'));
    const before = fs.statSync(file);
    await new Promise((r) => setTimeout(r, 25));
    runAutoDeliverPass(opts, finished('2026-08-27-ship-it.md'));
    expect(fs.statSync(file).mtimeMs).toBe(before.mtimeMs);
    expect([...(readInFlight(opts.repoRoot, Date.now(), 'deliver').branches ?? [])]).toEqual(['ship-it']);
    await settle();
  });

  it('writes when a slug is added, and when a slug is retired', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    const t0 = Date.now();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // `gone` is a mark for a plan the pulse reads delivered: retired.
    fs.writeFileSync(file, JSON.stringify({ marks: { gone: t0 } }));
    const mtime = (): string => fs.readFileSync(file, 'utf8');
    const delivered = pulse([['2026-08-27-gone.md', 'delivered', [slice('W', [['feature/g', 'merged']])]]]);
    runAutoDeliverPass({ ...opts, scripts: fakeScripts().scripts }, delivered, t0);
    expect(JSON.parse(mtime()).marks).toEqual({});
    const fake = fakeScripts();
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished(), t0 + 1);
    expect(JSON.parse(mtime()).marks).toEqual({ 'ship-it': t0 + 1 });
    expect(fake.started).toEqual(['ship-it']);
  });

  it('keeps the delivery marks apart from the dispatch marks', () => {
    const { opts } = fixture('');
    expect(inFlightPath(opts.repoRoot, 'deliver')).not.toBe(inFlightPath(opts.repoRoot));
  });
});

/** A pid no process holds: above every platform's pid limit. */
const DEAD_PID = 0x7ffffff0;

/**
 * A `Scripts` port that starts nothing real.
 *
 * `hang` hands back a started run that ends only when the test calls `exit`;
 * `error` hands back no pid and emits `error`; `error-exit` emits `error` and
 * then `exit 1`, which a failed spawn can do.
 */
const fakeScripts = (how: 'hang' | 'error' | 'error-exit' = 'hang', pid = DEAD_PID) => {
  const started: string[] = [];
  let onExit: StartOptions['onExit'];
  const scripts = {
    start: (_script: string, args: readonly string[], options: StartOptions = {}) => {
      started.push(args[0]);
      onExit = options.onExit;
      if (how === 'hang') return { pid, started: true };
      setTimeout(() => {
        options.onError?.(new Error('spawn bash ENOENT'));
        if (how === 'error-exit') options.onExit?.(1, null);
      }, 0);
      return { pid: 0, started: how === 'error-exit' };
    },
  } as unknown as Scripts;
  return { scripts, started, exit: (code: number) => onExit?.(code, null) };
};

const deliverFile = (repoRoot: string) =>
  JSON.parse(fs.readFileSync(inFlightPath(repoRoot, 'deliver'), 'utf8')) as {
    marks: Record<string, number>;
    pids?: Record<string, number>;
    failures?: Record<string, { count: number; lastAt: number; reading: string }>;
  };

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('runAutoDeliverPass — a failed delivery retries, and stops', () => {
  // H1. Each failure waits a longer delay, and the third stops the retry.
  it('stops an always-failing delivery after the bound, with a growing delay', async () => {
    const { opts } = fixture('');
    const fake = fakeScripts();
    const o = { ...opts, scripts: fake.scripts };
    const p = finished();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => void logs.push(args.join(' '));
    try {
      let now = Date.now();
      for (let attempt = 1; attempt <= AUTO_DELIVER_MAX_FAILURES; attempt++) {
        runAutoDeliverPass(o, p, now);
        expect(fake.started).toHaveLength(attempt);
        fake.exit(1);
        const failure = deliverFile(opts.repoRoot).failures?.['ship-it'];
        expect(failure?.count).toBe(attempt);
        if (attempt === AUTO_DELIVER_MAX_FAILURES) break;
        // NOT before the delay: a pass just short of it starts nothing.
        const lastAt = failure?.lastAt ?? 0;
        runAutoDeliverPass(o, p, lastAt + retryDelayMs(attempt) - 1);
        expect(fake.started).toHaveLength(attempt);
        now = lastAt + retryDelayMs(attempt);
      }
      // STOPPED: no later pass starts it, however late.
      runAutoDeliverPass(o, p, Date.now() + 365 * 24 * 3_600_000);
      expect(fake.started).toHaveLength(AUTO_DELIVER_MAX_FAILURES);
      expect(logs.filter((l) => l.includes('needs a person'))).toHaveLength(1);
      expect(fs.readFileSync(deliverLogPath(opts.repoRoot, 'ship-it'), 'utf8')).toContain('needs a person');
    } finally {
      console.log = origLog;
    }
  });

  it('waits longer after the second failure than after the first', async () => {
    const { opts } = fixture('');
    const fake = fakeScripts();
    const o = { ...opts, scripts: fake.scripts };
    const p = finished();
    runAutoDeliverPass(o, p);
    fake.exit(1);
    const first = deliverFile(opts.repoRoot).failures?.['ship-it']?.lastAt ?? 0;
    runAutoDeliverPass(o, p, first + retryDelayMs(1));
    expect(fake.started).toHaveLength(2);
    fake.exit(1);
    const second = deliverFile(opts.repoRoot).failures?.['ship-it']?.lastAt ?? 0;
    // The first delay no longer suffices.
    runAutoDeliverPass(o, p, second + retryDelayMs(1));
    expect(fake.started).toHaveLength(2);
    runAutoDeliverPass(o, p, second + retryDelayMs(2));
    expect(fake.started).toHaveLength(3);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
  });

  it('resets the count when a delivery succeeds', async () => {
    const { opts } = fixture('');
    const fake = fakeScripts();
    const o = { ...opts, scripts: fake.scripts };
    const p = finished();
    runAutoDeliverPass(o, p);
    fake.exit(1);
    expect(deliverFile(opts.repoRoot).failures?.['ship-it']?.count).toBe(1);
    const lastAt = deliverFile(opts.repoRoot).failures?.['ship-it']?.lastAt ?? 0;
    runAutoDeliverPass(o, p, lastAt + retryDelayMs(1));
    expect(fake.started).toHaveLength(2);
    fake.exit(0);
    expect(deliverFile(opts.repoRoot).failures).toBeUndefined();
    await settle();
  });

  it('resets the count when the plan reading changes', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({
      marks: {},
      failures: { 'ship-it': { count: AUTO_DELIVER_MAX_FAILURES, lastAt: now, reading: 'feature/a=open' } },
    }));
    const fake = fakeScripts();
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished(), now);
    expect(fake.started).toEqual(['ship-it']);
    expect(deliverFile(opts.repoRoot).failures).toBeUndefined();
  });

  it('reads a mark file written before this change', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({ marks: { 'ship-it': now - 1_000 } }));
    const read = readInFlight(opts.repoRoot, now, 'deliver');
    expect([...(read.branches ?? [])]).toEqual(['ship-it']);
    expect(read.pids).toEqual({});
    expect(read.failures).toEqual({});
    expect(read.error).toBe('');
  });

  it('drops a malformed pid or failure entry and keeps the rest', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({
      marks: { a: now },
      pids: { a: 12, b: -1, c: 'x' },
      failures: { a: { count: 1, lastAt: now, reading: 'r' }, b: { count: 0, lastAt: now, reading: 'r' }, c: 'x', d: { count: 1, lastAt: 'x', reading: 'r' }, e: { count: 1, lastAt: now } },
    }));
    const read = readInFlight(opts.repoRoot, now, 'deliver');
    expect(read.pids).toEqual({ a: 12 });
    expect(Object.keys(read.failures)).toEqual(['a']);
  });
});

describe('runAutoDeliverPass — a mark is renewed only while its delivery runs', () => {
  // M1 case A: the supervisor restarted mid-delivery, and the orphan died.
  it('lets an orphaned mark expire and counts the expiry as a failure', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const t0 = Date.now();
    fs.writeFileSync(file, JSON.stringify({ marks: { 'ship-it': t0 }, pids: { 'ship-it': DEAD_PID } }));
    const fake = fakeScripts();
    const o = { ...opts, scripts: fake.scripts };
    // Past the renewal age, inside the lifetime: not renewed, not restarted.
    runAutoDeliverPass(o, finished(), t0 + IN_FLIGHT_RENEW_AFTER_MS + 1);
    expect(deliverFile(opts.repoRoot).marks['ship-it']).toBe(t0);
    expect(fake.started).toEqual([]);
    // Past the lifetime: the mark lapses and counts as one failed attempt.
    const lapsedAt = t0 + IN_FLIGHT_DELIVER_TTL_MS;
    runAutoDeliverPass(o, finished(), lapsedAt);
    const after = deliverFile(opts.repoRoot);
    expect(after.marks).toEqual({});
    expect(after.failures?.['ship-it']?.count).toBe(1);
    expect(fake.started).toEqual([]);
    // And the retry follows the delay.
    runAutoDeliverPass(o, finished(), lapsedAt + retryDelayMs(1));
    expect(fake.started).toEqual(['ship-it']);
  });

  it('renews an orphaned mark while its recorded pid is alive', () => {
    const { opts } = fixture('');
    const file = inFlightPath(opts.repoRoot, 'deliver');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const t0 = Date.now();
    fs.writeFileSync(file, JSON.stringify({ marks: { 'ship-it': t0 }, pids: { 'ship-it': process.pid } }));
    const fake = fakeScripts();
    const at = t0 + IN_FLIGHT_RENEW_AFTER_MS;
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished(), at);
    expect(deliverFile(opts.repoRoot).marks['ship-it']).toBe(at);
    expect(fake.started).toEqual([]);
  });

  it('records the pid of a script delivery and drops it at the exit', () => {
    const { opts } = fixture('');
    const fake = fakeScripts('hang', 4242);
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished());
    expect(deliverFile(opts.repoRoot).pids).toEqual({ 'ship-it': 4242 });
    fake.exit(0);
    expect(deliverFile(opts.repoRoot).pids).toBeUndefined();
  });

  // M1 case B: the spawn emits `error`, with or without an `exit` after it.
  it.each(['error', 'error-exit'] as const)('clears the mark and counts one failure on a spawn %s', async (how) => {
    const { opts } = fixture('');
    const fake = fakeScripts(how);
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished());
    await tick();
    const after = deliverFile(opts.repoRoot);
    expect(after.marks).toEqual({});
    expect(after.failures?.['ship-it']?.count).toBe(1);
  });

  it('clears the mark and counts one failure when the deliver log cannot open', () => {
    const { opts } = fixture('');
    // A directory where the log file should be makes `open(…, 'a')` fail.
    fs.mkdirSync(deliverLogPath(opts.repoRoot, 'ship-it'), { recursive: true });
    const fake = fakeScripts();
    runAutoDeliverPass({ ...opts, scripts: fake.scripts }, finished());
    expect(fake.started).toEqual([]);
    const after = deliverFile(opts.repoRoot);
    expect(after.marks).toEqual({});
    expect(after.failures?.['ship-it']?.count).toBe(1);
  });
});

describe('runAutoDeliverPass — the renewal margin', () => {
  it('survives a pass gap of one scan budget plus its margin', () => {
    expect(IN_FLIGHT_PASS_GAP_MS).toBeGreaterThan(FLEET_SCAN_BUDGET_MS);
    const { opts } = fixture('');
    const fake = fakeScripts();
    const o = { ...opts, scripts: fake.scripts };
    const t0 = Date.now();
    runAutoDeliverPass(o, finished(), t0);
    // The last pass that does NOT renew: just under the renewal age.
    const quiet = t0 + IN_FLIGHT_RENEW_AFTER_MS - 1;
    runAutoDeliverPass(o, finished(), quiet);
    expect(deliverFile(opts.repoRoot).marks['ship-it']).toBe(t0);
    for (const gap of [FLEET_SCAN_BUDGET_MS, IN_FLIGHT_PASS_GAP_MS]) {
      // Any reader at the next pass still sees the mark.
      expect([...(readInFlight(opts.repoRoot, quiet + gap, 'deliver').branches ?? [])]).toEqual(['ship-it']);
    }
    runAutoDeliverPass(o, finished(), quiet + FLEET_SCAN_BUDGET_MS);
    expect(deliverFile(opts.repoRoot).marks['ship-it']).toBe(quiet + FLEET_SCAN_BUDGET_MS);
    expect(fake.started).toEqual(['ship-it']);
    fake.exit(0);
  });
});

