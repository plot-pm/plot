import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSprintFile, planStatusBySlug } from '../../src/server/board.js';
import { activeSprints } from '../../src/server/fleet.js';
import { FleetSprintSchema, type FleetPulse } from '../../src/contract/schema.js';

// The `Counted` wave: the fleet payload carries each Active sprint with its
// target release and three exhaustive counts (open/wip/done), aggregated
// server-side from `plan.status`. These fixtures build real plan files, run
// the real `plot-plan-meta.sh`, and assert the tally — the three counts are
// a TALLY of `planStatus`, never a second computation of it.
//
// Every member lands in exactly one bucket, so `total = open + wip + done`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The artifact ships next to Plot's scripts; the tests run against the real
// `plot-plan-meta.sh`, the same source `buildBoard` reads from.
const SCRIPTS_DIR = path.resolve(HERE, '../../../../skills/plot/scripts');

/** A plan file whose `## Status` block drives the phase/review/started fields. */
function planFile(status: string): string {
  return `# Fixture plan\n\n## Status\n\n${status}\n\n## Waves\n\n### Only (Branch: feature/x)\n- do the thing\n`;
}

/**
 * A temp repo with `docs/plans/` and `docs/sprints/active/`, plus opts pointing
 * at the real scripts. The plan filename carries the date prefix `planSlug`
 * strips, so `2026-08-24-<slug>.md` joins the sprint's `[<slug>]`.
 */
function withEstate(
  plans: Record<string, string>,
  sprints: Record<string, string>,
): { repoRoot: string; scriptsDir: string } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sprints-'));
  const plansDir = path.join(repoRoot, 'docs/plans');
  const activeDir = path.join(repoRoot, 'docs/sprints/active');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(activeDir, { recursive: true });
  for (const [slug, status] of Object.entries(plans)) {
    fs.writeFileSync(path.join(plansDir, `2026-08-24-${slug}.md`), planFile(status), 'utf8');
  }
  for (const [name, body] of Object.entries(sprints)) {
    fs.writeFileSync(path.join(activeDir, name), body, 'utf8');
  }
  return { repoRoot, scriptsDir: SCRIPTS_DIR };
}

const APPROVED = `- **Phase:** Approved\n- **Type:** feature\n- **Review:** in-session`;
const STARTED = `${APPROVED}\n- **Started:** 2026-08-24, tester, \`feature/x\``;
const DELIVERED = `- **Phase:** Delivered\n- **Type:** feature\n- **Review:** in-session`;
const RELEASED = `- **Phase:** Released\n- **Type:** feature\n- **Review:** in-session`;

/** A pulse whose single plan file has one merged wave — makes a Started plan `deliverable`. */
const mergedPulse = (planBasename: string): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: planBasename,
    slices: [{
      name: 'Only',
      verdict: 'complete',
      branches: [{
        branch: 'feature/x', state: 'merged', deferred: false,
        claimed: '', local_dirty: false, local_worktree: '',
      }],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
});

function sprintFile(status: string, members: string): string {
  return `# Sprint: Fixture\n\n## Status\n\n${status}\n\n### Must Have\n\n${members}\n`;
}

describe('parseSprintFile — release', () => {
  it('reads the `- **Release:** x.y.z` record from the ## Status block', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-release-'));
    const abs = path.join(dir, '2026-W40-fixture.md');
    fs.writeFileSync(abs, `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n- **Release:** 2.9.0\n`, 'utf8');
    expect(parseSprintFile(abs)!.release).toBe('2.9.0');
  });

  it('is "" when the sprint names no release — never a placeholder', async () => {
    // The control renders nothing rather than "→ —", so absence must reach it as
    // an empty string.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-release-'));
    const abs = path.join(dir, '2026-W40-fixture.md');
    fs.writeFileSync(abs, `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n`, 'utf8');
    expect(parseSprintFile(abs)!.release).toBe('');
  });

  it("reads this repo's own W35 file's release", async () => {
    const abs = path.resolve(
      HERE, '../../../../docs/sprints/2026-W35-the-board-tells-the-truth-in-every-section.md',
    );
    expect(parseSprintFile(abs)!.release).toBe('2.9.0');
  });
});

describe('activeSprints — the three exhaustive counts, aggregated from plan.status', () => {
  it('tallies each member into its bucket, and carries the release', async () => {
    const opts = withEstate(
      {
        'plan-app': APPROVED,       // approved → open
        'plan-run': STARTED,        // in-progress → wip
        'plan-done': DELIVERED,     // delivered → done
        'plan-ship': RELEASED,      // released → done
      },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 3.1.0',
          '- [ ] [plan-app] a\n- [ ] [plan-run] b\n- [ ] [plan-done] c\n- [ ] [plan-ship] d\n',
        ),
      },
    );
    const [sprint] = await activeSprints(opts, null);
    expect(sprint.slug).toBe('alpha');
    expect(sprint.release).toBe('3.1.0');
    // 4 members: 1 open (approved), 1 wip (in-progress), 2 done (delivered + released)
    expect(sprint.counts).toEqual({ total: 4, open: 1, wip: 1, done: 2 });
    // FleetSprintSchema accepts the shape the server emits.
    expect(() => FleetSprintSchema.parse(sprint)).not.toThrow();
  });

  it('a merged pulse turns a started, approved plan into `deliverable` (wip)', async () => {
    // Same plan, two pulses: the count follows `planStatus`, which reads the
    // pulse's merge state. Both in-progress and deliverable land in WIP.
    const opts = withEstate(
      { 'plan-run': STARTED },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 3.1.0',
          '- [ ] [plan-run] b\n',
        ),
      },
    );
    // No pulse: in-progress → wip
    expect((await activeSprints(opts, null))[0].counts)
      .toEqual({ total: 1, open: 0, wip: 1, done: 0 });
    // With merged pulse: deliverable → still wip
    expect((await activeSprints(opts, mergedPulse('2026-08-24-plan-run.md')))[0].counts)
      .toEqual({ total: 1, open: 0, wip: 1, done: 0 });
  });

  it('excludes a `### Deferred` member from counts — a deferral is not a commitment', async () => {
    const opts = withEstate(
      { 'plan-app': APPROVED, 'plan-shelf': APPROVED },
      {
        '2026-W40-alpha.md':
          `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n\n` +
          `### Must Have\n\n- [ ] [plan-app] a\n\n` +
          `### Deferred\n\n- [ ] [plan-shelf] shelved\n`,
      },
    );
    // Both plans are `approved`, but only the Must-tier one is counted.
    const counts = (await activeSprints(opts, null))[0].counts;
    expect(counts.open).toBe(1);
    expect(counts.total).toBe(1);
  });

  it('a member naming no plan the board found adds to nothing — total still sums', async () => {
    const opts = withEstate(
      { 'plan-app': APPROVED },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active',
          '- [ ] [plan-app] a\n- [ ] [ghost] renamed away\n',
        ),
      },
    );
    // The ghost has no status; counts are 1, not a crash and not a phantom.
    // total === open + wip + done, even with a ghost.
    const counts = (await activeSprints(opts, null))[0].counts;
    expect(counts.open).toBe(1);
    expect(counts.total).toBe(1);
    expect(counts.total).toBe(counts.open + counts.wip + counts.done);
  });

  it('renders one entry per Active sprint — two teams, one train', async () => {
    const opts = withEstate(
      { 'plan-a': APPROVED, 'plan-b': DELIVERED },
      {
        '2026-W40-first.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 1.0.0', '- [ ] [plan-a] a\n',
        ),
        '2026-W40-second.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 2.0.0', '- [ ] [plan-b] b\n',
        ),
      },
    );
    const out = (await activeSprints(opts, null)).sort((x, y) => x.slug.localeCompare(y.slug));
    expect(out.map((s) => s.slug)).toEqual(['first', 'second']);
    expect(out.map((s) => s.release)).toEqual(['1.0.0', '2.0.0']);
    expect(out[0].counts.open).toBe(1);      // approved → open
    expect(out[1].counts.done).toBe(1);      // delivered → done
  });

  it('ignores a Closed sprint left in the active dir', async () => {
    const opts = withEstate(
      { 'plan-a': APPROVED },
      {
        '2026-W40-closed.md': sprintFile(
          '- **Phase:** Closed\n- **Release:** 1.0.0', '- [ ] [plan-a] a\n',
        ),
      },
    );
    expect(await activeSprints(opts, null)).toEqual([]);
  });

  it('is [] when no sprint is Active — the control shows its disabled state', async () => {
    const opts = withEstate({ 'plan-a': APPROVED }, {});
    expect(await activeSprints(opts, null)).toEqual([]);
  });

  it('total === open + wip + done — the invariant the plan requires', async () => {
    // This is Done when item 3: the three counts sum to the member total.
    // The old four buckets (delivered, deliverable, inProgress, approved)
    // could silently drop a Draft member; these three cannot.
    const opts = withEstate(
      {
        'plan-draft': `- **Phase:** Draft\n- **Type:** feature\n- **Review:** in-session`,
        'plan-open': `- **Phase:** Draft\n- **Type:** feature\n- **Review:** pr`,
        'plan-approved': APPROVED,
        'plan-started': STARTED,
        'plan-done': DELIVERED,
        'plan-shipped': RELEASED,
      },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active',
          '- [ ] [plan-draft] a\n- [ ] [plan-open] b\n- [ ] [plan-approved] c\n' +
          '- [ ] [plan-started] d\n- [ ] [plan-done] e\n- [ ] [plan-shipped] f\n',
        ),
      },
    );
    const counts = (await activeSprints(opts, null))[0].counts;
    // 6 members, all counted: draft + open + approved → 3 open, started → 1 wip, delivered + released → 2 done
    expect(counts).toEqual({ total: 6, open: 3, wip: 1, done: 2 });
    expect(counts.total).toBe(counts.open + counts.wip + counts.done);
  });
});

describe('planStatusBySlug — reads plan.status, does not recompute it', () => {
  it('keys each working-tree plan by slug to its planStatus answer', async () => {
    const opts = withEstate(
      { 'plan-app': APPROVED, 'plan-done': DELIVERED },
      {},
    );
    const map = await planStatusBySlug(opts, null);
    expect(map.get('plan-app')).toBe('approved');
    expect(map.get('plan-done')).toBe('delivered');
  });
});
