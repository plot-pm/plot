import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { answered, failed, placeDelivery } from '@plot-pm/domain';
import { rowsFromPulse, withDesks, withFixerInFlight } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';
import { deliveryMapping, type DeliveryMapInput, type RegistryAgent } from '../../src/app/lib/agent-rows/delivery-readings.js';

// A planless branch or PR reaches the board through the two planless loops in
// `rowsFromPulse`, which state `wip` or `claimed` for every row they build. The
// loose-end rule must therefore read its hold from the desk, the registry and
// the worker, never from `state`, or nothing is ever placed as loose.

const QUIET = 30;
const NOBODY = 'feature/nobody-works-on-it';
const DESK = 'feature/at-a-desk';
const MANIFEST = 'feature/an-agent-holds-it';
const CLAIMED = 'feature/claim-nobody-holds';
const OPEN_PR = 'feature/an-unplanned-pr';
const RELEASE = 'changeset-release/main';

const pulse: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
};

const pr = (head: string, number: number) => ({
  number, head, state: 'OPEN', draft: false, checks: 'green', mergeable: 'mergeable', review: '', url: '',
}) as never;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-loose-e2e-'));
  made.push(dir);
  return dir;
};

const branches = [NOBODY, DESK, MANIFEST, CLAIMED];

const derive = async (trees: Parameters<typeof withDesks>[1]) => {
  const ages = new Map<string, number | null>([...branches, OPEN_PR, RELEASE].map((b) => [b, 600]));
  const prs = new Map([[OPEN_PR, pr(OPEN_PR, 41)], [RELEASE, pr(RELEASE, 42)]]);
  const pulseRows = rowsFromPulse(
    pulse, ages, 'plot', QUIET, prs, '', null, Date.now(),
    null, null, null, null, null, '', null, new Set(branches), undefined, undefined, undefined, undefined, undefined, undefined,
    new Set([CLAIMED]),
  );
  return withDesks(await withFixerInFlight(pulseRows, repo()), trees);
};

const desks = answered([
  { path: '/repo', branch: 'main', isMain: true },
  { path: '/repo/.worktrees/desk', branch: DESK, isMain: false },
] as never);

const placed = (rows: Awaited<ReturnType<typeof derive>>) => {
  const agents = [{ session: 's', branch: MANIFEST, state: 'running', pid: 1 }] as unknown as RegistryAgent[];
  const input: DeliveryMapInput = {
    rows, slices: [], agents, drafts: [], reader: { hostUser: 'me' }, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
  };
  const m = deliveryMapping(input);
  const p = placeDelivery(m.readings, m.input);
  return (branch: string) => ({
    item: p.items.find((i) => i.id === `branch:${branch}`),
    unplaced: p.unplaced.find((u) => u.id === `branch:${branch}`),
  });
};

describe('a planless branch or PR, from the row builder to the placement', () => {
  it('states wip or claimed for every planless row, the states the rule must not read as a hold', async () => {
    const rows = await derive(desks);
    expect(rows.find((r) => r.branch === NOBODY)!.state).toBe('wip');
    expect(rows.find((r) => r.branch === CLAIMED)!.state).toBe('claimed');
    expect(rows.find((r) => r.branch === OPEN_PR)!.state).toBe('wip');
  });

  it('places an unworked planless branch under You > Unblock as loose', async () => {
    const at = placed(await derive(desks));
    expect(at(NOBODY).item).toMatchObject({ section: 'you', group: 'unblock', reason: 'loose', kind: 'branch' });
  });

  it('places an unworked planless open PR under You > Unblock as loose', async () => {
    const at = placed(await derive(desks));
    expect(at(OPEN_PR).item).toMatchObject({ section: 'you', group: 'unblock', reason: 'loose', kind: 'pr' });
  });

  it('places a claim nobody holds as loose, so release has a claim to give up', async () => {
    const at = placed(await derive(desks));
    expect(at(CLAIMED).item).toMatchObject({ reason: 'loose' });
  });

  it('keeps a branch with a desk on this machine, or a manifest, out of loose', async () => {
    const at = placed(await derive(desks));
    expect(at(DESK).item?.reason).not.toBe('loose');
    expect(at(MANIFEST).item?.reason).not.toBe('loose');
  });

  it('never places changeset-release/main as loose', async () => {
    const at = placed(await derive(desks));
    expect(at(RELEASE).item?.reason).not.toBe('loose');
    expect(at(RELEASE).item?.kind).toBe('release');
  });

  it('lists every planless branch as unplaced for unread where the worktree listing failed', async () => {
    const at = placed(await derive(failed('failed')));
    expect(at(NOBODY).item).toBeUndefined();
    expect(at(NOBODY).unplaced).toMatchObject({ reason: 'unread' });
    expect(at(MANIFEST).item?.reason).not.toBe('loose');
  });
});
