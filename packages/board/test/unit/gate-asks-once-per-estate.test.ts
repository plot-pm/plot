// The delivery-landed gate measures the estate ONCE per unchanged estate, and
// its answer is the board's.
//
// **WHY THIS GATE AND NOT "A SKILL THAT READS FLEET STATE TWICE".** The plan
// believed five skills did; a recount on 2026-08-30 found four of those were
// prose or a help block. Three greps for one question gave 25, 14 and 5 call
// sites, and `plot-reconcile`'s apparent three are ONE invocation shown three
// ways — full sweep, `--no-fetch`, `--offline`. Re-verified here 2026-08-31:
// `grep -rn reconcile-scan skills/` still finds exactly one caller that asks
// twice in a run, `plot-deliver`'s delivery-landed gate.
//
// **So this gate is the single witness, and an assertion aimed at a population
// that does not exist passes vacuously.** This repo has found that defect three
// times. The test below therefore drives the gate's ACTUAL loop shape — scan,
// grep, fix, scan again, repeat until the grep is empty — rather than asserting
// a property of "skills that ask twice".
//
// **The cache under test is a MEASUREMENT, never a timer.** Every case here
// changes the estate by changing what the scan READS (a ref SHA, a plan's
// bytes) and asserts a second measurement follows. Nothing sleeps, so a cache
// that expired on a clock would pass the hit cases and fail none of the miss
// cases — which is precisely why the miss cases are content changes rather than
// waits.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  askOnce,
  askOncePerEstate,
  askedWithoutTransport,
  newMemory,
} from '../../src/server/entry/ask.js';
import { estateFingerprint, sameEstate } from '../../src/server/entry/estate-fingerprint.js';
import { boardState } from '../../src/server/controllers/fleet-state.js';
import type { Board, Column } from '../../src/contract/schema.js';
import type { EstateSource } from '../../src/server/controllers/fleet-state.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills/plot/scripts');

/** A scratch repo with one plan and one remote ref — an estate that can move. */
const makeRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '# Test\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n',
  );
  writePlan(dir, 'Approved');
  git('add', '-A');
  git('commit', '-qm', 'plan');
  // A remote ref, so the fingerprint has ref state to measure. `update-ref`
  // rather than a real remote: the digest reads `refs/remotes/origin/*`, and
  // what it must notice is the SHA moving, not how it got there.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
};

const planPath = (dir: string) =>
  path.join(dir, 'docs/plans/2026-08-30-a-plan-the-gate-can-read.md');

const writePlan = (dir: string, phase: string) =>
  fs.writeFileSync(
    planPath(dir),
    ['# A plan the gate can read', '', '## Status', '',
      `- **Phase:** ${phase}`, '- **Type:** feature', ''].join('\n'),
  );

/**
 * An estate source that counts how often it was read.
 *
 * The scan is minutes of git and host calls; what this file asserts is HOW MANY
 * TIMES it is asked, which is a property of the caller and needs no real scan
 * to observe. Counting a substituted source is the same substitution the
 * controller was built for, used to measure the caller instead of to fake the
 * world.
 */
const countingSource = (columns: Column[]) => {
  const state = { reads: 0 };
  const source: EstateSource = {
    columns: () => {
      state.reads += 1;
      return columns;
    },
    fleet: () => {
      state.reads += 1;
      throw new Error('the gate asks the board question, not the fleet one');
    },
  };
  return { source, state };
};

const COLUMNS: Column[] = [
  { name: 'Approved', cards: [{ slug: 'a-plan-the-gate-can-read' }] } as unknown as Column,
];

describe("the delivery-landed gate measures once per unchanged estate", () => {
  it('asks once when the fix changed nothing the scan reads', () => {
    const dir = makeRepo();
    try {
      const { source, state } = countingSource(COLUMNS);
      const memory = newMemory();
      const ask = {
        question: 'board' as const,
        opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR },
        estate: source,
        planDir: 'docs/plans',
      };

      // The gate's loop: scan, grep, and — the grep having found nothing that
      // changed the estate — scan again.
      const first = askOncePerEstate(memory, ask);
      const second = askOncePerEstate(memory, ask);

      expect(first.measured, 'the first ask has nothing to re-use').toBe(true);
      expect(second.measured, 'the second ask reads an estate already measured').toBe(false);
      expect(state.reads, 'the estate was read once, not twice').toBe(1);
      expect(second.value, 'the re-used answer is the same answer').toBe(first.value);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks again when the fix edited a plan — the gate\'s own repair', () => {
    const dir = makeRepo();
    try {
      const { source, state } = countingSource(COLUMNS);
      const memory = newMemory();
      const ask = {
        question: 'board' as const,
        opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR },
        estate: source,
        planDir: 'docs/plans',
      };

      askOncePerEstate(memory, ask);
      // EXACTLY what the gate's fix does: flip the phase and write the record.
      // No ref moved and no file was added — only the bytes the scan reads.
      writePlan(dir, 'Delivered');
      const after = askOncePerEstate(memory, ask);

      expect(after.measured, 'a plan edit is an estate change').toBe(true);
      expect(state.reads, 'the changed estate was measured again').toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks again when the fix pushed — a ref that moved', () => {
    const dir = makeRepo();
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      const { source, state } = countingSource(COLUMNS);
      const memory = newMemory();
      const ask = {
        question: 'board' as const,
        opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR },
        estate: source,
        planDir: 'docs/plans',
      };

      askOncePerEstate(memory, ask);
      // The other half of the gate's fix: the commit lands on the remote. The
      // plan files on disk are untouched, so ONLY the ref state differs.
      fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'pushed\n');
      git('add', '-A');
      git('commit', '-qm', 'delivery');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const after = askOncePerEstate(memory, ask);

      expect(after.measured, 'a moved ref is an estate change').toBe(true);
      expect(state.reads, 'the changed estate was measured again').toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the gate\'s repeat-until-empty loop, measuring once per estate', () => {
    const dir = makeRepo();
    try {
      const { source, state } = countingSource(COLUMNS);
      const memory = newMemory();
      const ask = {
        question: 'board' as const,
        opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR },
        estate: source,
        planDir: 'docs/plans',
      };

      // The gate as written in plot-deliver/SKILL.md §7b: ask, grep, apply a
      // fix while the grep finds drift, ask again; stop when it is empty. Two
      // fixes, then a clean pass — four asks over three distinct estates.
      //
      // The phases are the ones the plan does NOT already carry. A first draft
      // of this fixture re-wrote `Approved` over `Approved` and asserted three
      // measurements against two: the bytes were identical, so the estate had
      // not changed and the cache was right to hold. Worth keeping as a note —
      // a fixture whose "fix" changes nothing is testing the cache's hit path
      // while claiming to test its miss path.
      const phases = ['Delivered', 'Released'];
      let asks = 0;
      for (let round = 0; round <= phases.length; round += 1) {
        askOncePerEstate(memory, ask);
        asks += 1;
        if (round < phases.length) writePlan(dir, phases[round]);
      }
      // A final confirming pass over the estate the last ask already saw — the
      // "repeat until the grep is empty" step that costs a full scan today.
      askOncePerEstate(memory, ask);
      asks += 1;

      expect(asks, 'the gate asked four times').toBe(4);
      expect(
        state.reads,
        'but measured three times — one per DISTINCT estate, not one per ask',
      ).toBe(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never re-uses an answer it could not measure', () => {
    // A directory that is not a repo: no refs, no plans. Two failed
    // measurements must not compare equal, or the cache would serve a stale
    // answer exactly where it knows least. Failing to a miss costs a scan;
    // failing to a hit costs a wrong delivery gate.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-empty-'));
    try {
      const opts = { repoRoot: dir, scriptsDir: SCRIPTS_DIR };
      const a = estateFingerprint(opts, 'docs/plans');
      const b = estateFingerprint(opts, 'docs/plans');

      expect(a.digest, 'two unmeasurable estates hash the same').toBe(b.digest);
      expect(sameEstate(a, b), 'but are never treated as the same estate').toBe(false);

      const { source, state } = countingSource(COLUMNS);
      const memory = newMemory();
      const ask = { question: 'board' as const, opts, estate: source, planDir: 'docs/plans' };
      askOncePerEstate(memory, ask);
      askOncePerEstate(memory, ask);
      expect(state.reads, 'so every ask measures').toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the gate's answer is identical to the board's", () => {
  it('returns what the route serialises, byte for byte', () => {
    const dir = makeRepo();
    try {
      const opts = { repoRoot: dir, scriptsDir: SCRIPTS_DIR };

      // The controller as the ROUTE calls it, and as the ENTRY POINT calls it.
      // The same function, so the claim is that the entry point adds nothing
      // and subtracts nothing on the way past.
      const viaRoute = boardState({ opts });
      const viaEntry = askOnce({ question: 'board', opts, planDir: 'docs/plans' }) ;

      // EXCEPT `generatedAt`, and the exception is measured rather than
      // assumed: `buildBoard` stamps `new Date().toISOString()` on every
      // answer, so two calls can only agree on it if two clock reads do. A
      // first draft of this test compared the whole string and failed on a
      // 1.3 s difference with all 21 other fields identical — which is the
      // assertion succeeding, reported as a failure.
      //
      // Dropped from BOTH sides rather than overwritten on one, so a change
      // that stopped emitting the field fails the presence check below instead
      // of passing silently.
      const { generatedAt: entryAt, ...entryRest } = viaEntry.value as Board;
      const { generatedAt: routeAt, ...routeRest } = viaRoute;

      expect(
        JSON.stringify(entryRest),
        'the master agent and the browser read one answer',
      ).toBe(JSON.stringify(routeRest));
      expect(typeof entryAt, 'the entry point still stamps the answer').toBe('string');
      expect(typeof routeAt, 'and so does the route').toBe('string');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names the absence of a transport rather than refusing', () => {
    const dir = makeRepo();
    try {
      const answer = askOnce({
        question: 'board',
        opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR },
        planDir: 'docs/plans',
      }).value as Board;

      // The discovery the Asking slice recorded and left to this one: a caller
      // with no server reads `available: false` on all ten flags, which is
      // honest about the binding but reads like a refusal.
      //
      // It is NOT rewritten here, and that is the answer rather than a
      // deferral — rewriting would invent a permission no caller granted, and
      // changing the field's shape would move the payload every slice in this
      // plan has refused to move. The absence is made CHECKABLE instead.
      expect(askedWithoutTransport(answer), 'no transport was supplied').toBe(true);

      // And the distinction is real rather than a convention: an unavailable
      // capability with an EMPTY reason is an absence, while every refusal a
      // real caller produces carries a sentence. Verified 2026-08-31 —
      // `localCapability` cannot emit an unavailable answer with no reason, so
      // the two cases can never collide.
      const refused: Board = {
        ...answer,
        dispatch: { available: false, reason: 'the board is bound to 0.0.0.0, not localhost' },
      };
      expect(
        askedWithoutTransport(refused),
        'a stated refusal is not an absence',
      ).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
