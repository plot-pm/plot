import { beforeAll, describe, expect, it } from 'vitest';

import { readingsFrom } from '../../board/src/server/entry/agent-state.js';
import { agentState } from '../src/rules/agent-state.js';
import { AgentStateSchema } from '../src/entities/agent.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { readDesks, type AgentStateRow, type Estate } from './production.js';

/**
 * DOES `agentState` ANSWER WHAT `plot_worker_state` ANSWERS, on every desk on
 * this machine?
 *
 * THE SECOND RULE-VERSUS-SHELL COMPARISON, built to the contract
 * `docs/shell-and-domain.md` states and the first one proved. `scoreItem`
 * against `item_state` was the smallest case — 12 lines of bash, one function.
 * This is the case the contract exists for: `plot-worker-state.sh` is sourced
 * by FIVE scripts, one of them `plot-worker-loop.sh`, the agent's own loop
 * running unattended per agent for the length of a slice. Measured: `node`
 * starts in 39 ms, so the shell keeps its own deriver and pays no hop, and
 * this test is what stops the two drifting.
 *
 * NEITHER SIDE IS AUTHORITATIVE. The test says they agree. On a disagreement
 * the branch stops; adjusting either side to make this pass is the one move
 * forbidden, because it cements a production bug behind a green test.
 *
 * PRODUCTION SUPPLIES BOTH HALVES — the readings `plot_worker_readings`
 * printed and the verdict `plot_worker_state` reached over the same desk in
 * the same pass. Assembling the readings here from the worktree would compare
 * the domain against this test's own gathering.
 *
 * THE READINGS ARE PARSED BY THE ENTRY POINT, not by this file. `readingsFrom`
 * in `board/src/server/entry/agent-state.ts` is what production uses to turn
 * the shell's line into the rule's input, so a parser that misread a field
 * would misread it identically here and the comparison would pass over a
 * broken seam. Importing the real one is what closes that.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The pair this file compares, and the words its report uses.
 *
 * `adapter=` / `production=` name the pair the four adapter corpus files
 * compare. Here neither side is an adapter: they are two implementations of one
 * rule, so the report names them as such.
 */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

let desks: AgentStateRow[];

beforeAll(() => {
  desks = readDesks(estate);
});

describe('agentState agrees with plot-worker-state.sh', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR, because the assertions below are universally quantified and a
    // universal claim over an empty set is true. Measured 2026-09-07: 8 desks
    // on this machine — the main checkout plus the fleet's. Asserted as a
    // minimum rather than a constant, because a machine running no fleet has
    // one desk and CI's sandbox has few.
    expect(desks.length).toBeGreaterThan(0);
    // Every row carries both halves, or the comparison below is comparing an
    // empty string against a state.
    expect(desks.every((desk) => desk.state !== '')).toBe(true);
    expect(desks.every((desk) => desk.readings.split('\t').length === 7)).toBe(true);
  });

  it('answers what the shell answers, on every desk', () => {
    const found: Disagreement[] = [];
    for (const desk of desks) {
      compareField(
        found,
        desk.name,
        'state',
        agentState(readingsFrom(desk.readings)),
        desk.state,
      );
    }
    // ONE comparison rather than an assertion per desk: a failure has to name
    // every disagreeing desk, because one desk disagreeing and all of them
    // disagreeing are different findings pointing at different bugs.
    expect(found.map(report)).toEqual([]);
  });

  it('compares states both sides can actually name', () => {
    // NOT VACUOUS IN THE OTHER DIRECTION EITHER. Agreement over a corpus whose
    // every desk answered the same word would be an accident of the machine.
    // The estate cannot be made to hold all eight on demand — `elsewhere` is
    // unreachable through a worktree list, by construction — so this asserts
    // what an estate CAN vary and leaves the completeness claim to
    // `test/agent-state.test.ts`, where the readings are chosen.
    const answered = new Set(desks.map((desk) => desk.state));
    for (const state of answered) {
      expect(AgentStateSchema.options as readonly string[]).toContain(state);
    }
    // The readings must vary, or the rule is being asked one question
    // repeatedly. Liveness is the field the machine always splits: a fleet has
    // live desks and dead ones, and a machine with one desk has the one
    // running this test.
    const liveness = new Set(desks.map((desk) => desk.readings.split('\t')[2]));
    expect(liveness.size).toBeGreaterThan(0);
  });

  it('agrees on the desks that are alive right now', () => {
    // THE SUBSET WORTH NAMING SEPARATELY. A live worker is the one state a
    // wrong answer strands: `running` tells every reader to leave the desk
    // alone, so a rule that lost it would have the fleet reap a working agent.
    const live = desks.filter((desk) => desk.readings.split('\t')[2] === 'live');
    for (const desk of live) {
      expect(agentState(readingsFrom(desk.readings))).toBe('running');
      expect(desk.state).toBe('running');
    }
  });

  it('reports a disagreement naming the desk and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    // `"1 disagreement"` sends a reader hunting; this names the desk and what
    // each side said.
    const line = report({
      subject: 'free-cfa16919',
      field: 'state',
      adapter: '"stalled"',
      production: '"finished"',
    });
    expect(line).toBe('free-cfa16919 :: state :: rule="stalled" shell="finished"');
  });
});
