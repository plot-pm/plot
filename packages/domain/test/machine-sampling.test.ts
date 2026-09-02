import { describe, it, expect } from 'vitest';

import { machineSystem, DEFAULT_SAMPLE_BUDGET_MS } from '../src/adapters/machine/machine-system.js';
import { shellContext } from '../src/adapters/scripts.js';
import { headroomFor, measureMachine } from '../src/entities/machine.js';
import { isAnswered } from '../src/port-result.js';
import type { ScriptRun } from '../src/adapters/run-script.js';

/**
 * THE SAMPLING BOUND — the slice's real work.
 *
 * A count-bounded loop costs `samples x spawnCostMs`, so it is at its most
 * expensive on exactly the machine it exists to detect: measured 2026-08-30,
 * 100 forks at 287 ms/fork spent 28.7 s answering whether the machine was busy.
 * That is the story's own complaint reproduced by its fix.
 *
 * A real starved machine cannot be conjured in a test, so the process is the
 * seam. `run` and `now` are injected, and a stub that answers in 287 ms of
 * VIRTUAL time proves the bound without spending 28.7 s of real time.
 */

const context = shellContext('/nowhere');

/**
 * A process stub whose every call costs `costMs` on a clock the test advances.
 *
 * The clock is virtual: nothing sleeps, so the assertions are about the
 * adapter's arithmetic rather than about the test runner's scheduling — which
 * is what keeps them from flaking on a loaded CI machine.
 */
function slowMachine(costMs: number) {
  let clock = 0;
  let forks = 0;
  const run = async (): Promise<ScriptRun> => {
    clock += costMs;
    forks += 1;
    return { code: 0, stdout: '.git', stderr: '' };
  };
  return { run, now: () => clock, forks: () => forks };
}

describe('the sampling is bounded by time, not by count', () => {
  it('stops at the budget rather than after samples x 287 ms', async () => {
    // The measured starved machine. A count-bounded loop would take all 100.
    const stub = slowMachine(287);
    const machine = machineSystem(context, {
      run: stub.run,
      now: stub.now,
      sampleBudgetMs: 250,
    });

    const reading = await machine.measure(100);

    expect(isAnswered(reading)).toBe(true);
    if (!isAnswered(reading)) return;
    // One fork already exceeds the 250 ms budget, so it stops after one — not
    // after 100. This is the whole point: 287 ms spent, not 28,700 ms.
    expect(stub.forks()).toBe(1);
    expect(reading.value.sampleMs).toBe(287);
    expect(reading.value.sampleMs).toBeLessThan(100 * 287);
  });

  it('reports the cost it actually measured, not the cost it was asked for', async () => {
    // THE DIVISOR IS THE BUG THE BOUND WOULD OTHERWISE INTRODUCE. Dividing the
    // elapsed time by `samples` after an early stop reports 287/100 = 2.87 ms —
    // a CLEAR verdict from a machine that is starving, under-reported by
    // exactly the factor that made the stop necessary.
    const stub = slowMachine(287);
    const machine = machineSystem(context, { run: stub.run, now: stub.now, sampleBudgetMs: 250 });

    const reading = await machine.measure(100);

    expect(isAnswered(reading)).toBe(true);
    if (!isAnswered(reading)) return;
    expect(reading.value.spawnCostMs).toBe(287);
    expect(headroomFor(reading.value.spawnCostMs)).toBe('starved');
  });

  it('takes every sample on a clear machine, where the budget is never reached', async () => {
    // The bound must not cost a clear machine its resolution: 5 forks at 4.8 ms
    // is 24 ms, far inside the budget, so all five are taken.
    const stub = slowMachine(4.8);
    const machine = machineSystem(context, { run: stub.run, now: stub.now, sampleBudgetMs: 250 });

    const reading = await machine.measure(5);

    expect(isAnswered(reading)).toBe(true);
    if (!isAnswered(reading)) return;
    expect(stub.forks()).toBe(5);
    expect(reading.value.spawnCostMs).toBeCloseTo(4.8, 5);
    expect(headroomFor(reading.value.spawnCostMs)).toBe('clear');
  });

  it('always takes at least one reading, even on a zero budget', async () => {
    // A measurement that returns without forking has measured nothing, and
    // `sampleMs / 0` is NaN — which `headroomFor` reads as neither clear nor
    // starved, silently returning `tight`. The floor is what makes the
    // division total.
    const stub = slowMachine(287);
    const machine = machineSystem(context, { run: stub.run, now: stub.now, sampleBudgetMs: 0 });

    const reading = await machine.measure(100);

    expect(isAnswered(reading)).toBe(true);
    if (!isAnswered(reading)) return;
    expect(stub.forks()).toBe(1);
    expect(Number.isNaN(reading.value.spawnCostMs)).toBe(false);
    expect(reading.value.spawnCostMs).toBe(287);
  });

  it('defaults to a budget small against the board’s 5 s pulse', () => {
    // Pinned so a change is deliberate: the bound is only a bound if it is
    // smaller than the cadence it protects.
    expect(DEFAULT_SAMPLE_BUDGET_MS).toBe(250);
    expect(DEFAULT_SAMPLE_BUDGET_MS).toBeLessThan(5_000);
  });

  it('reports a failed probe as failed rather than as a fast machine', async () => {
    // A probe that cannot run has measured nothing. Reporting it as a cheap
    // fork would be the worst possible reading: `clear`, from a broken git.
    const machine = machineSystem(context, {
      run: async () => ({ code: 128, stdout: '', stderr: 'not a git repository' }),
      now: () => 0,
    });

    const reading = await machine.measure(5);

    expect(reading.ok).toBe(false);
  });
});

describe('a bounded reading still answers the dispatch question', () => {
  it('reads starved from three forks the same as from a hundred', async () => {
    // "A reading from three forks is still a reading" — the bound changes what
    // the measurement COSTS, never what it MEANS.
    const stub = slowMachine(287);
    const machine = machineSystem(context, { run: stub.run, now: stub.now, sampleBudgetMs: 600 });

    const reading = await machine.measure(100);
    expect(isAnswered(reading)).toBe(true);
    if (!isAnswered(reading)) return;

    expect(stub.forks()).toBe(3);
    const verdict = measureMachine({
      spawnCostMs: reading.value.spawnCostMs,
      measuredAt: 1_000,
      sampleMs: reading.value.sampleMs,
      loadAverage: reading.value.loadAverage,
      cores: reading.value.cores,
    });
    expect(verdict.headroom).toBe('starved');
  });
});

describe('machineSystem: where this machine can be reached', () => {
  it('answers a mesh address or an empty string, never a failure', async () => {
    // BOTH OUTCOMES ARE THE CONTRACT, so this asserts the shape rather than the
    // value: `tailscale` is absent on most machines and logged out on some, and
    // each exits non-zero meaning *there is no mesh address* rather than *the
    // machine could not be asked*. A test demanding an address would pass only
    // on a meshed runner; one demanding emptiness would fail on a meshed
    // developer's laptop. What must hold everywhere is that the call answers.
    const answer = await machineSystem(context).privateAddress();
    expect(answer.ok).toBe(true);
    expect(typeof (answer.ok && answer.value)).toBe('string');
  });

  it('answers one address, not one per interface', async () => {
    // `tailscale ip -4` prints a line per interface. A caller building a URL
    // needs one, so a newline in the answer would be a defect that only shows
    // up on a multi-interface machine — asserted here where it costs nothing.
    const answer = await machineSystem(context).privateAddress();
    expect(answer.ok && answer.value).not.toContain('\n');
  });
});
