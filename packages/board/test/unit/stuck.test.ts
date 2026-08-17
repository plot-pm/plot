import { describe, it, expect, vi } from 'vitest';
import {
  isArtifactOnly, stuckState, summarizeStuck, stuckSummaryLine,
  type StuckInput,
} from '../../src/server/stuck.js';
import { BOARD_ARTIFACT_PATH, StuckSchema } from '../../src/contract/schema.js';

// Detection is where this wave's judgments live: whether a branch can MOVE is a
// different question from what it IS, and none of `classify`'s answers can say
// it. Tested as a pure function rather than through HTTP — a wrong state is a
// wrong answer no plumbing can fix, and the four states differ in the only way
// that matters, which is what a person does next.

const OTHER = 'packages/board/src/server/fleet.ts';

/** A healthy in-progress branch: pushed work, no conflicts, nothing failing. */
function healthy(over: Partial<StuckInput> = {}): StuckInput {
  return {
    state: 'wip',
    conflicts: [],
    conflictsKnown: true,
    localAhead: 0,
    prState: 'green',
    changedPaths: ['README.md'],
    ...over,
  };
}

describe('stuckState — each state is named separately', () => {
  // ONE LABEL FOR ALL FOUR IS THE DEFECT. The four are not degrees of one
  // thing: they differ in what happens next, and the whole cost this wave pays
  // off is a reader having to go find out which.
  it('names an artifact-only conflict, a real conflict, unpushed work and a failing check apart', () => {
    const artifact = stuckState(healthy({ conflicts: [BOARD_ARTIFACT_PATH] }));
    const conflict = stuckState(healthy({ conflicts: [OTHER] }));
    const unpushed = stuckState(healthy({ localAhead: 2 }));
    const ci = stuckState(healthy({ prState: 'failing' }));

    expect(artifact?.state).toBe('artifact-conflict');
    expect(conflict?.state).toBe('conflict');
    expect(unpushed?.state).toBe('unpushed');
    expect(ci?.state).toBe('ci-failing');

    const states = [artifact, conflict, unpushed, ci].map((s) => s?.state);
    expect(new Set(states).size).toBe(4);
  });

  it('carries the evidence that produced each state', () => {
    // A row that says *stuck* and makes the reader go find out why has moved
    // the ten minutes of log-reading rather than removed it.
    expect(stuckState(healthy({ conflicts: [OTHER] }))?.conflicts).toEqual([OTHER]);
    expect(stuckState(healthy({ localAhead: 3 }))?.localAhead).toBe(3);

    const ci = stuckState(healthy({
      prState: 'failing',
      changedPaths: ['docs/plan.md'],
      failingChecks: ['validate'],
      runHistory: [{ workflow: 'CI', conclusion: 'success', startedAt: '2026-08-17T10:17:00Z', url: 'u' }],
    }));
    expect(ci?.changedPaths).toEqual(['docs/plan.md']);
    expect(ci?.failingChecks).toEqual(['validate']);
    expect(ci?.runHistory).toHaveLength(1);
  });
});

describe('artifact-only versus artifact-among', () => {
  // THE PAIRING THAT MATTERS. An implementation asking "is the artifact among
  // the conflicts?" passes the first assertion and silently misclassifies the
  // second — resolving, mechanically, a merge that needs judgement.
  it('treats exactly the artifact as resolvable and the artifact plus anything else as not', () => {
    const only = stuckState(healthy({ conflicts: [BOARD_ARTIFACT_PATH] }));
    const mixed = stuckState(healthy({ conflicts: [BOARD_ARTIFACT_PATH, OTHER] }));

    expect(only?.state).toBe('artifact-conflict');
    expect(mixed?.state).toBe('conflict');
  });

  it('rejects the artifact-among shape at the predicate too', () => {
    // Asserted directly as well as through the detector: a test that could only
    // reach this through the whole function would be testing two things, and
    // the predicate is the sentence the resolver in wave 3 will read.
    expect(isArtifactOnly([BOARD_ARTIFACT_PATH])).toBe(true);
    expect(isArtifactOnly([BOARD_ARTIFACT_PATH, OTHER])).toBe(false);
    expect(isArtifactOnly([OTHER])).toBe(false);
    expect(isArtifactOnly([])).toBe(false);
    // Order must not decide it either — a set is a set.
    expect(isArtifactOnly([OTHER, BOARD_ARTIFACT_PATH])).toBe(false);
  });

  it('does not let ordering hide a mixed set', () => {
    // The detector sorts before deciding, so a scan that emitted the artifact
    // last cannot read as artifact-only.
    expect(stuckState(healthy({ conflicts: [OTHER, BOARD_ARTIFACT_PATH] }))?.state)
      .toBe('conflict');
  });

  it('does not accept a path that merely ends in the artifact name', () => {
    // `vendor/…/board-server.mjs` is a different file, and a suffix match would
    // hand wave 3 a rebuild that proves nothing about it.
    expect(isArtifactOnly([`vendor/${BOARD_ARTIFACT_PATH}`])).toBe(false);
  });
});

describe('a CI failure is evidence, never a verdict', () => {
  it('reports the step, the changed paths and the run history without classifying', () => {
    const s = stuckState(healthy({
      prState: 'failing',
      changedPaths: ['docs/a.md', 'docs/b.md'],
      failingChecks: ['Install Playwright browser'],
      runHistory: [
        { workflow: 'CI', conclusion: 'failure', startedAt: '2026-08-17T10:19:00Z', url: 'u2' },
        { workflow: 'CI', conclusion: 'success', startedAt: '2026-08-17T10:17:00Z', url: 'u1' },
      ],
    }));

    expect(s?.state).toBe('ci-failing');
    expect(s?.failingChecks).toEqual(['Install Playwright browser']);
    expect(s?.changedPaths).toEqual(['docs/a.md', 'docs/b.md']);
    expect(s?.runHistory.map((r) => r.conclusion)).toEqual(['failure', 'success']);

    // AND NO VERDICT. The state word is the shape, not a claim about this
    // failure: nothing says transient, foreign, flaky, infra, or mine. The
    // rejected alternative was a heuristic mapping failing steps to changed
    // paths — a table nobody maintains, silently wrong the first time the
    // workflow is restructured.
    const words = JSON.stringify(s).toLowerCase();
    for (const verdict of ['transient', 'foreign', 'flaky', 'infra', 'unrelated', 'retry']) {
      expect(words).not.toContain(verdict);
    }
  });

  it('says nothing about a failure it cannot name', () => {
    // No check names available (Bitbucket, an older adapter) still reports the
    // failure with the evidence it has. [] is *no names*, never *nothing
    // failed* — `state` is what says a check failed.
    const s = stuckState(healthy({ prState: 'failing', failingChecks: [] }));
    expect(s?.state).toBe('ci-failing');
    expect(s?.failingChecks).toEqual([]);
  });

  it('does not report a green, pending or unchecked PR as stuck', () => {
    for (const p of ['green', 'pending', 'none', 'unknown'] as const) {
      expect(stuckState(healthy({ prState: p }))).toBeNull();
    }
  });
});

describe('unpushed work is reported and never fixed', () => {
  it('reports the count', () => {
    const s = stuckState(healthy({ localAhead: 4 }));
    expect(s?.state).toBe('unpushed');
    expect(s?.localAhead).toBe(4);
  });

  // THE #177 CASE. From outside, a rebase that stayed local is
  // indistinguishable from an agent that stopped — and it cost half an hour of
  // dead CI on 2026-08-17 because nothing said so.
  it('is the one thing distinguishing a local rebase from a stopped agent', () => {
    const stopped = stuckState(healthy({ localAhead: 0 }));
    const rebased = stuckState(healthy({ localAhead: 1 }));
    expect(stopped).toBeNull();
    expect(rebased?.state).toBe('unpushed');
  });
});

describe('a branch that is not stuck produces nothing', () => {
  // A watcher that flags everything flags nothing — the whole value of a
  // populated result is that it is rare enough to look at.
  it('returns null for a healthy in-progress branch', () => {
    expect(stuckState(healthy())).toBeNull();
  });

  it('returns null for merged and deferred branches whatever else is true', () => {
    // Merged work has already moved; deferred work was given up deliberately.
    // Neither is waiting on anybody, so a cue on either is the flags-everything
    // failure in its purest form.
    for (const state of ['merged', 'deferred'] as const) {
      expect(stuckState(healthy({
        state, conflicts: [OTHER], localAhead: 9, prState: 'failing',
      }))).toBeNull();
    }
  });

  it('returns null for an unstarted branch with nothing observed', () => {
    expect(stuckState({
      state: 'open', conflicts: [], conflictsKnown: false, localAhead: 0, prState: null,
    })).toBeNull();
  });
});

describe('absent is not clean', () => {
  // The rule that is hardest to hold here, because an empty conflict list is
  // the shape BOTH answers arrive in: "merges cleanly" and "nobody could ask".
  it('reports no conflict when the set was not observed, even if one is listed', () => {
    // A caller that hands over a list without the flag has not observed
    // anything, and reading the list anyway would invent an answer.
    expect(stuckState(healthy({ conflicts: [OTHER], conflictsKnown: false }))).toBeNull();
  });

  it('does not read an unobserved set as mergeable either', () => {
    // The negative half: an unanswerable branch that is ALSO unpushed still
    // reports the fact it does have. Silence about conflicts is not a clean
    // bill of health for the branch.
    const s = stuckState(healthy({ conflictsKnown: false, localAhead: 2 }));
    expect(s?.state).toBe('unpushed');
  });
});

describe('precedence', () => {
  // GitHub starts no workflow for a branch that does not merge cleanly, so a
  // conflicting PR always ALSO reports an empty rollup. Reading checks first
  // reports the consequence and withholds the cause — measured on PR #149 and
  // PR #160, both of which said *no checks* while GitHub said *conflicts*.
  it('puts a conflict ahead of a failing check', () => {
    const s = stuckState(healthy({ conflicts: [OTHER], prState: 'failing' }));
    expect(s?.state).toBe('conflict');
  });

  it('puts a conflict ahead of unpushed work', () => {
    // The conflict is a fact everyone can see; `localAhead` is true only on the
    // machine doing the looking.
    const s = stuckState(healthy({ conflicts: [OTHER], localAhead: 5 }));
    expect(s?.state).toBe('conflict');
  });

  it('puts a failing check ahead of unpushed work', () => {
    const s = stuckState(healthy({ prState: 'failing', localAhead: 5 }));
    expect(s?.state).toBe('ci-failing');
  });
});

describe('nothing is written', () => {
  // ASSERTED STRUCTURALLY, not by watching for a call. The module imports
  // nothing that CAN write — no child_process, no fs, no network — so there is
  // no push, no commit and no file write to suppress on any path. A spy would
  // only prove the paths the test happened to walk.
  it('imports no module capable of writing anything', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../src/server/stuck.ts', import.meta.url), 'utf8');
    // The IMPORTS, not the prose: the comments name `child_process` in order to
    // explain why it is absent, and an assertion over the whole file would fail
    // on its own reasoning. One type-only import of the contract is the entire
    // reachable surface, so there is no push, commit or file write to suppress
    // on any path — a property a spy could only prove for the paths it walked.
    const imports = [...src.matchAll(/^\s*(?:import|}) from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['../contract/schema.js']);
    expect(src).not.toMatch(/^\s*(?:import|const)\s.*\b(?:child_process|node:fs|node:http|node:net)\b/m);
    expect(src).not.toMatch(/\b(?:execFile|execSync|spawn|writeFileSync|fetch)\s*\(/);
  });

  it('does not mutate the input it is handed', () => {
    // A detector that sorted its caller's array in place would be a write, and
    // the quietest kind: the scan's own document would change under it.
    const conflicts = [OTHER, BOARD_ARTIFACT_PATH];
    const changedPaths = ['b.md', 'a.md'];
    const before = [[...conflicts], [...changedPaths]];
    stuckState(healthy({ conflicts, changedPaths, prState: 'failing' }));
    expect([conflicts, changedPaths]).toEqual(before);
  });

  it('returns arrays that no other result shares', () => {
    // Two branches with nothing to report must not receive the same array: a
    // consumer sorting one in place would reach into the other.
    const a = stuckState(healthy({ localAhead: 1 }))!;
    const b = stuckState(healthy({ localAhead: 1 }))!;
    expect(a.changedPaths).not.toBe(b.changedPaths);
    expect(a.conflicts).not.toBe(b.conflicts);
  });
});

describe('stateless', () => {
  // Every state is re-derived from the facts handed in, so there is no watcher
  // state to become stale — which is the reason the watcher cannot drift from
  // reality (Principle 1, the posture plot-fleet-scan.sh already takes).
  it('reaches identical conclusions from identical inputs, in any order, any number of times', () => {
    const inputs: StuckInput[] = [
      healthy(),
      healthy({ conflicts: [BOARD_ARTIFACT_PATH] }),
      healthy({ conflicts: [BOARD_ARTIFACT_PATH, OTHER] }),
      healthy({ localAhead: 2 }),
      healthy({ prState: 'failing', failingChecks: ['validate'] }),
    ];
    const first = inputs.map((i) => stuckState(i));
    // Re-run in reverse, then again forwards: a stateful detector would give a
    // different answer the second time or let one branch affect the next.
    const reversed = [...inputs].reverse().map((i) => stuckState(i)).reverse();
    const again = inputs.map((i) => stuckState(i));
    expect(reversed).toEqual(first);
    expect(again).toEqual(first);
  });

  it('does not consult the clock', () => {
    // A conclusion that moves with time is a conclusion that goes stale, and a
    // stale one is exactly what a stateless design promises not to produce.
    const now = vi.spyOn(Date, 'now');
    stuckState(healthy({ conflicts: [OTHER] }));
    stuckState(healthy({ prState: 'failing' }));
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

describe('the machine-countable footer', () => {
  it('counts each state separately and prints every one at zero', () => {
    const results = [
      stuckState(healthy({ conflicts: [BOARD_ARTIFACT_PATH] })),
      stuckState(healthy({ conflicts: [OTHER] })),
      stuckState(healthy()),
    ];
    const summary = summarizeStuck(results);
    expect(summary).toEqual({ stuck: 2, artifact: 1, conflict: 1, unpushed: 0, ci: 0 });
    // The shape this repo's other scans emit — a consumer reads this line
    // rather than re-counting a body. `unpushed=0` is PRESENT: a key that
    // vanished when zero could not be read as zero, only as unknown.
    expect(stuckSummaryLine(summary, 'main'))
      .toBe('summary: stuck=2 artifact=1 conflict=1 unpushed=0 ci=0 main=main');
  });

  it('reports all zeroes for a healthy fleet', () => {
    expect(stuckSummaryLine(summarizeStuck([null, null]), 'main'))
      .toBe('summary: stuck=0 artifact=0 conflict=0 unpushed=0 ci=0 main=main');
  });

  it('counts every state, so the total is never a label over four errands', () => {
    const summary = summarizeStuck([
      stuckState(healthy({ conflicts: [BOARD_ARTIFACT_PATH] })),
      stuckState(healthy({ conflicts: [OTHER] })),
      stuckState(healthy({ localAhead: 1 })),
      stuckState(healthy({ prState: 'failing' })),
    ]);
    expect(summary.stuck).toBe(4);
    expect(summary.artifact + summary.conflict + summary.unpushed + summary.ci)
      .toBe(summary.stuck);
  });
});

describe('the contract', () => {
  it('validates every state the detector produces', () => {
    for (const input of [
      healthy({ conflicts: [BOARD_ARTIFACT_PATH] }),
      healthy({ conflicts: [OTHER] }),
      healthy({ localAhead: 1 }),
      healthy({ prState: 'failing', failingChecks: ['validate'] }),
    ]) {
      expect(() => StuckSchema.parse(stuckState(input))).not.toThrow();
    }
  });

  it('treats an older payload as nothing looked for, not nothing found', () => {
    // Every field defaults, so a document written before the detection existed
    // still validates — and says only what it knows.
    const parsed = StuckSchema.parse({ state: 'conflict' });
    expect(parsed.conflicts).toEqual([]);
    expect(parsed.failingChecks).toEqual([]);
    expect(parsed.runHistory).toEqual([]);
    expect(parsed.localAhead).toBe(0);
  });
});
