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
import {
  planAutoDeliver,
  pruneDelivering,
  maybeAutoDeliver,
  planSlug,
  DELIVER_COMMAND_KEY,
} from '../../src/server/auto-deliver.js';
import { FleetPulseSchema, type FleetPulse } from '../../src/contract/schema.js';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autodel-repo-'));
  const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autodel-scripts-'));
  made.push(repoRoot, scriptsDir);

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
    `#!/usr/bin/env bash\nprintf 'reap %s\\n' "$*" >> ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );

  return {
    opts: { repoRoot, scriptsDir },
    runs: () =>
      fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [],
  };
}

/**
 * Long enough for a delivery AND the reap chained to its exit.
 *
 * Two spawns in SEQUENCE, not one: the reap starts only when the delivery's
 * `exit` fires, so this must cover both process startups plus the stub's own
 * `sleep 0.15`. At 700 ms it was under-budgeted and the reap assertions read an
 * empty marker — which looks exactly like the ordering being broken, rather
 * than like a wait that ended too early.
 */
const settle = (ms = 2500) => new Promise((r) => setTimeout(r, ms));

// THE VERDICT IS DERIVED, NOT DECLARED. It was hardcoded 'complete' for every
// wave, including ones holding an open branch — a shape the real scan cannot
// emit: plot-fleet-scan.sh sets complete only when outstanding -eq 0.
//
// That inconsistency was invisible while allWavesMerged re-walked the branch
// states, because it never read the field. Since #491 it reads the VERDICT (the
// scan already computed this, and two derivations of one question is the
// duplication this repo keeps removing), so a fixture claiming complete over an
// unmerged branch now asserts the opposite of what its test means — it turned
// ITEM 6, the gate that delivers NOTHING while a wave is unmerged, green-to-red.
//
// Deriving it keeps every fixture honest by construction: a test states its
// branches and cannot contradict itself in a field it never thought about.
const wave = (
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

const pulse = (plans: Array<[string, string, ReturnType<typeof wave>[]]>): FleetPulse =>
  FleetPulseSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, waves]) => ({ file, phase, waves })),
    summary: {
      plans: plans.length, waves: 0, branches: 0,
      claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    },
  });

/** An approved plan whose single wave has merged — the deliverable case. */
const finished = (file = '2026-08-27-ship-it.md') =>
  pulse([[file, 'approved', [wave('W', [['feature/a', 'merged']])]]]);

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
        wave('One', [['feature/a', 'merged']]),
        wave('Two', [['feature/b', 'open']]),
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
        wave('One', [['feature/a', 'deferred']]),
        wave('Two', [['feature/b', 'deferred']]),
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
        wave('One', [['feature/a', 'merged']]),
        wave('Two', [['feature/b', 'deferred']]),
      ]],
    ]);
    expect(planAutoDeliver({ pulse: p, inFlight: new Set() }).map((x) => x.slug)).toEqual(['mixed']);
  });

  it('refuses a plan that is not approved — draft, delivered and released alike', () => {
    for (const phase of ['draft', 'delivered', 'released']) {
      const p = pulse([['2026-08-27-ship-it.md', phase, [wave('W', [['feature/a', 'merged']])]]]);
      expect(planAutoDeliver({ pulse: p, inFlight: new Set() })).toEqual([]);
    }
  });

  it('refuses a plan with no branches at all', () => {
    const p = pulse([['2026-08-27-empty.md', 'approved', [wave('W', [])]]]);
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
    const p = pulse([['2026-08-27-ship-it.md', 'delivered', [wave('W', [['feature/a', 'merged']])]]]);
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
    expect(runs().map((l) => l.split(' ')[0])).toEqual(['agent', 'reap']);
  });

  // ITEM 4 — THE ORDERING, and the reason this whole fixture funnels both stubs
  // into one file. Both orders end with a delivered plan and no worktree; only
  // this sequence never shows a desk-less `Approved` plan mid-flight.
  it('ITEM 4: the reap runs AFTER the delivery, in that order', async () => {
    const { opts, runs } = fixture('');
    maybeAutoDeliver(opts, finished(), new Set());
    await settle();
    const order = runs().map((l) => l.split(' ')[0]);
    expect(order).toEqual(['deliver', 'reap']);
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
  });

  it('spawns nothing for a plan that is not deliverable', async () => {
    const { opts, runs } = fixture('');
    const p = pulse([['2026-08-27-ship-it.md', 'approved', [wave('W', [['feature/a', 'open']])]]]);
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
