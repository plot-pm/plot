// The agent panel: uptime derived from a pid, and facts that omit rather than guess.
//
// Two properties carry this file. **Uptime is a reading, not a memory** — a
// worker that has exited has no uptime at all, rather than a number that keeps
// growing after the process it describes is gone. And **the panel's renderer has
// no code path that prints a placeholder**: a field it could not read is not in
// the markup.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { branchFromPulse, parseEtime, uptimeSeconds } from '../../src/server/agent-panel.js';

describe('parsing what ps reports', () => {
  // The four shapes measured from `ps -o etime=` on 2026-08-19. Linux adds no
  // fifth. The day-bearing form is the one no test process can live long enough
  // to produce, so it is asserted directly rather than observed.
  const shapes: [string, number][] = [
    ['00:42', 42],
    ['17:29:43', 17 * 3600 + 29 * 60 + 43],
    ['60-00:33:12', 60 * 86_400 + 33 * 60 + 12],
    ['  01:02  ', 62],
  ];
  for (const [raw, seconds] of shapes) {
    it(`reads ${JSON.stringify(raw)} as ${seconds}s`, () => {
      assert.equal(parseEtime(raw), seconds);
    });
  }

  // Anything unrecognised is an ABSENT uptime, never a zero. A zero would render
  // as "up 0s" for a process that may have been running for hours.
  for (const raw of ['', '   ', 'not a time', '12', '1:2:3:4', 'ELAPSED']) {
    it(`refuses ${JSON.stringify(raw)} rather than guessing`, () => {
      assert.equal(parseEtime(raw), null);
    });
  }
});

describe('uptime is read from the process, not stored', () => {
  it('measures this very process, which is certainly alive', async () => {
    const up = await uptimeSeconds(String(process.pid));
    assert.notEqual(up, null, 'a running pid must report an uptime');
    assert.ok(typeof up === 'number' && up >= 0);
  });

  it('reports NO uptime for a pid nobody is running', async () => {
    // THE "no fabricated uptime" REQUIREMENT, at its source. A stored launch
    // timestamp would still be here, and would still be counting.
    //
    // 99998 rather than a huge number: `ps` rejects an out-of-range pid with a
    // different error than "no such process", and the assertion should exercise
    // the ordinary absent-process path.
    assert.equal(await uptimeSeconds('99998'), null);
  });

  it('refuses pid 0 — `kill -0 0` signals the whole process group', async () => {
    // The trap this repo has sprung before: a naive liveness check on pid 0
    // succeeds forever, so a 0 would report an agent alive that never was.
    assert.equal(await uptimeSeconds('0'), null);
  });

  for (const bad of ['', 'abc', '-1', '12x', '1 2']) {
    it(`refuses a malformed pid ${JSON.stringify(bad)}`, async () => {
      assert.equal(await uptimeSeconds(bad), null);
    });
  }
});

describe('resolving a branch against the pulse', () => {
  const pulse = {
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    plans: [
      {
        file: 'docs/plans/2026-08-17-working-shows-the-agent.md',
        phase: 'Approved',
        slices: [
          {
            name: 'Panel',
            verdict: 'eligible',
            branches: [
              {
                branch: 'feature/the-agent-panel',
                local_worktree: '/tmp/wt-panel',
                worker: 'running',
                worker_pid: '4242',
              },
            ],
          },
        ],
      },
    ],
    summary: { plans: 1, waves: 1, branches: 1 },
  } as never;

  it('answers with what the scan reported for the branch', () => {
    const found = branchFromPulse(pulse, 'feature/the-agent-panel');
    assert.deepEqual(found, {
      worktree: '/tmp/wt-panel',
      plan: 'docs/plans/2026-08-17-working-shows-the-agent.md',
      wave: 'Panel',
      worker: 'running',
      pid: '4242',
    });
  });

  // THE SECURITY BOUNDARY, and it is a lookup rather than a validator: these
  // match no `b.branch`, so they come back null rather than becoming a path.
  for (const evil of ['../../etc/passwd', '/etc/passwd', 'feature/../../x', '']) {
    it(`refuses ${JSON.stringify(evil)} — the pulse never named it`, () => {
      assert.equal(branchFromPulse(pulse, evil), null);
    });
  }

  it('answers null on a cold cache, licensing no claim', () => {
    assert.equal(branchFromPulse(null, 'feature/the-agent-panel'), null);
  });
});
