import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BRIDGE_MAX_AGE_MS, bridgePath, readBridge, writeBridge,
} from '../../src/server/pulse-bridge.js';
import type { FleetPulse } from '../../src/contract/schema.js';

// The rules the bridge lives by, as pure reads and writes. The restart itself
// is asserted across two real processes in `test/bridge.test.mjs` — this file
// pins the boundaries that a process restart cannot reach on demand: the
// expiry, a clock that moved, a shape from another build, and a file somebody
// truncated.

const PULSE: FleetPulse = {
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: '2026-08-17-a-plan.md',
    phase: 'approved',
    waves: [{
      name: 'One',
      verdict: 'eligible',
      branches: [{
        branch: 'feature/a', state: 'claimed', deferred: false, claimed: 'claimed: someone',
        local_dirty: false, local_worktree: '', local_ahead: 0, local_locked: false,
        worker: 'elsewhere', worker_pid: '', worker_exit: '',
      }],
    }],
  }],
  summary: {
    plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0,
  },
};

function bridged(at: number) {
  return {
    at,
    pulse: PULSE,
    ages: new Map<string, number | null>([['feature/a', 7], ['feature/unknown', null]]),
    branchUrlBase: 'https://github.com/plot-pm/plot/tree/',
    approvedAt: new Map<string, number>([['2026-08-17-a-plan.md', 1_700_000_000_000]]),
    ideaPlans: new Map<string, string>([['idea/a-plan', '2026-08-17-a-plan.md']]),
  };
}

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-bridge-unit-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('the bridge round-trips what a restart needs', () => {
  it('restores the pulse and every map beside it', () => {
    const now = Date.now();
    writeBridge(repo, bridged(now));
    const read = readBridge(repo, now);
    expect(read).not.toBeNull();
    expect(read!.pulse).toEqual(PULSE);
    // The maps are what the rows are BUILT from — ages drive every "last commit
    // N min ago", the URL base every branch link, the approval dates the
    // not-started ordering. A bridge that restored only the pulse would produce
    // rows that render but say less than the ones it replaced.
    expect(read!.ages.get('feature/a')).toBe(7);
    expect(read!.ages.get('feature/unknown')).toBeNull();
    expect(read!.branchUrlBase).toBe('https://github.com/plot-pm/plot/tree/');
    expect(read!.approvedAt.get('2026-08-17-a-plan.md')).toBe(1_700_000_000_000);
    expect(read!.ideaPlans.get('idea/a-plan')).toBe('2026-08-17-a-plan.md');
  });

  it('keeps the SCAN time rather than the write time', () => {
    // The page's whole honesty rests on this number: the banner, the `(frozen)`
    // footer and the stopped clocks all date from it. Restamping on write would
    // present a ten-minute-old answer as fresh.
    const scannedAt = Date.now() - 90_000;
    writeBridge(repo, bridged(scannedAt));
    expect(readBridge(repo, Date.now())!.at).toBe(scannedAt);
  });

  it('writes under .plot/state, machine-local by construction', () => {
    writeBridge(repo, bridged(Date.now()));
    expect(fs.existsSync(bridgePath(repo))).toBe(true);
    expect(bridgePath(repo)).toBe(path.join(repo, '.plot', 'state', 'last-pulse.json'));
  });

  it('leaves no temp file behind', () => {
    // The write goes through a temp name and a rename, so that a reader never
    // sees half a payload. A leftover temp would be litter in a directory the
    // operator's `.plot` shares with committed content.
    writeBridge(repo, bridged(Date.now()));
    const dir = path.dirname(bridgePath(repo));
    expect(fs.readdirSync(dir)).toEqual(['last-pulse.json']);
  });
});

describe('the bridge expires — it is a bridge, not a store', () => {
  it('serves a pulse just inside the window', () => {
    const now = Date.now();
    writeBridge(repo, bridged(now - (BRIDGE_MAX_AGE_MS - 1_000)));
    expect(readBridge(repo, now)).not.toBeNull();
  });

  it('refuses one just outside it', () => {
    // Past the threshold the honest answer is *no data* — which is what the
    // board already says, and correct once the numbers describe a repository
    // state that has moved on. A file that never expires is a second source of
    // truth about git (Principle 1).
    const now = Date.now();
    writeBridge(repo, bridged(now - (BRIDGE_MAX_AGE_MS + 1_000)));
    expect(readBridge(repo, now)).toBeNull();
  });

  it('refuses one stamped in the FUTURE', () => {
    // A clock that moved backwards, or a checkout copied from another machine.
    // `now - at` reads negative, which an age check alone would treat as the
    // freshest possible answer — the one direction where being lenient produces
    // a confident lie.
    const now = Date.now();
    writeBridge(repo, bridged(now + 60_000));
    expect(readBridge(repo, now)).toBeNull();
  });
});

describe('the bridge refuses anything it cannot trust', () => {
  it('returns null when there is no file at all', () => {
    expect(readBridge(repo)).toBeNull();
  });

  it('returns null for a truncated file rather than throwing', () => {
    // A board that crashed mid-write predates the rename; a board reading one
    // must still start. Throwing here would take the server down over a cache.
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), '{"version":1,"at":', 'utf8');
    expect(readBridge(repo)).toBeNull();
  });

  it('returns null for a payload from another version', () => {
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({ version: 99, at: Date.now() }), 'utf8');
    expect(readBridge(repo)).toBeNull();
  });

  it('returns null for a pulse that no longer validates', () => {
    // Re-parsed through `FleetPulseSchema` rather than trusted, because the
    // file may have been written by a build that is not this one. The board's
    // rule for host data — parse, do not assume — is not weaker for data it
    // wrote itself.
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({
      version: 1, at: Date.now(), pulse: { plans: 'not an array' },
    }), 'utf8');
    expect(readBridge(repo)).toBeNull();
  });

  it('drops malformed map entries instead of guessing at them', () => {
    const now = Date.now();
    fs.mkdirSync(path.dirname(bridgePath(repo)), { recursive: true });
    fs.writeFileSync(bridgePath(repo), JSON.stringify({
      version: 1,
      at: now,
      pulse: PULSE,
      // One good pair, and three shapes nothing should be inferred from. An
      // invented age would be a confident lie in the one place the page is
      // trying to say exactly what it knows.
      ages: [['feature/a', 7], ['feature/b', 'soon'], [42, 1], 'nonsense'],
      branchUrlBase: 12,
      approvedAt: null,
      ideaPlans: [['idea/x', 'x.md']],
    }), 'utf8');
    const read = readBridge(repo, now)!;
    expect(read.ages.size).toBe(1);
    expect(read.ages.get('feature/a')).toBe(7);
    expect(read.branchUrlBase).toBe('');
    expect(read.approvedAt.size).toBe(0);
    expect(read.ideaPlans.get('idea/x')).toBe('x.md');
  });

  it('does not throw when the repo cannot be written to', () => {
    // A read-only checkout, a full disk, a `.plot` nobody may write: none is a
    // reason for the board to stop serving. The cost of the miss is exactly
    // today's behaviour — one restart that cannot be spanned.
    const blocked = path.join(repo, 'not-a-directory');
    fs.writeFileSync(blocked, 'this is a file', 'utf8');
    expect(() => writeBridge(blocked, bridged(Date.now()))).not.toThrow();
    expect(readBridge(blocked)).toBeNull();
  });
});
