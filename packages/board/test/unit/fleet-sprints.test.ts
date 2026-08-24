import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSprintFile, planStatusBySlug } from '../../src/server/board.js';
import { activeSprints } from '../../src/server/fleet.js';
import { FleetSprintSchema, type FleetPulse } from '../../src/contract/schema.js';

// The `Counted` wave: the fleet payload carries each Active sprint with its
// target release and its four `status` counts, aggregated server-side from
// `plan.status`. These fixtures build real plan files, run the real
// `plot-plan-meta.sh`, and assert the tally — the four counts are a TALLY of
// `planStatus`, never a second computation of it.

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
    waves: [{
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
  it('reads the `- **Release:** x.y.z` record from the ## Status block', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-release-'));
    const abs = path.join(dir, '2026-W40-fixture.md');
    fs.writeFileSync(abs, `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n- **Release:** 2.9.0\n`, 'utf8');
    expect(parseSprintFile(abs)!.release).toBe('2.9.0');
  });

  it('is "" when the sprint names no release — never a placeholder', () => {
    // The control renders nothing rather than "→ —", so absence must reach it as
    // an empty string.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-release-'));
    const abs = path.join(dir, '2026-W40-fixture.md');
    fs.writeFileSync(abs, `# Sprint: Fixture\n\n## Status\n\n- **Phase:** Active\n`, 'utf8');
    expect(parseSprintFile(abs)!.release).toBe('');
  });

  it("reads this repo's own W35 file's release", () => {
    const abs = path.resolve(
      HERE, '../../../../docs/sprints/2026-W35-the-board-tells-the-truth-in-every-section.md',
    );
    expect(parseSprintFile(abs)!.release).toBe('2.9.0');
  });
});

describe('activeSprints — the four counts, aggregated from plan.status', () => {
  it('tallies each member into its status bucket, and carries the release', () => {
    const opts = withEstate(
      {
        'plan-app': APPROVED,       // approved
        'plan-run': STARTED,        // in-progress (Started, no merged pulse)
        'plan-done': DELIVERED,     // delivered
        'plan-ship': RELEASED,      // released — counted nowhere
      },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 3.1.0',
          '- [ ] [plan-app] a\n- [ ] [plan-run] b\n- [ ] [plan-done] c\n- [ ] [plan-ship] d\n',
        ),
      },
    );
    const [sprint] = activeSprints(opts, null);
    expect(sprint.slug).toBe('alpha');
    expect(sprint.release).toBe('3.1.0');
    expect(sprint.counts).toEqual({ delivered: 1, deliverable: 0, inProgress: 1, approved: 1 });
    // FleetSprintSchema accepts the shape the server emits.
    expect(() => FleetSprintSchema.parse(sprint)).not.toThrow();
  });

  it('a merged pulse turns a started, approved plan into `deliverable`', () => {
    // Same plan, two pulses: the count follows `planStatus`, which reads the
    // pulse's merge state. This is the value the control exists to surface.
    const opts = withEstate(
      { 'plan-run': STARTED },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active\n- **Release:** 3.1.0',
          '- [ ] [plan-run] b\n',
        ),
      },
    );
    expect(activeSprints(opts, null)[0].counts)
      .toEqual({ delivered: 0, deliverable: 0, inProgress: 1, approved: 0 });
    expect(activeSprints(opts, mergedPulse('2026-08-24-plan-run.md'))[0].counts)
      .toEqual({ delivered: 0, deliverable: 1, inProgress: 0, approved: 0 });
  });

  it('excludes a `### Deferred` member — a deferral is not a commitment', () => {
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
    expect(activeSprints(opts, null)[0].counts.approved).toBe(1);
  });

  it('a member naming no plan the board found adds to nothing', () => {
    const opts = withEstate(
      { 'plan-app': APPROVED },
      {
        '2026-W40-alpha.md': sprintFile(
          '- **Phase:** Active',
          '- [ ] [plan-app] a\n- [ ] [ghost] renamed away\n',
        ),
      },
    );
    // The ghost has no status; the count is 1, not a crash and not a phantom.
    expect(activeSprints(opts, null)[0].counts.approved).toBe(1);
  });

  it('renders one entry per Active sprint — two teams, one train', () => {
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
    const out = activeSprints(opts, null).sort((x, y) => x.slug.localeCompare(y.slug));
    expect(out.map((s) => s.slug)).toEqual(['first', 'second']);
    expect(out.map((s) => s.release)).toEqual(['1.0.0', '2.0.0']);
    expect(out[0].counts.approved).toBe(1);
    expect(out[1].counts.delivered).toBe(1);
  });

  it('ignores a Closed sprint left in the active dir', () => {
    const opts = withEstate(
      { 'plan-a': APPROVED },
      {
        '2026-W40-closed.md': sprintFile(
          '- **Phase:** Closed\n- **Release:** 1.0.0', '- [ ] [plan-a] a\n',
        ),
      },
    );
    expect(activeSprints(opts, null)).toEqual([]);
  });

  it('is [] when no sprint is Active — the control shows its disabled state', () => {
    const opts = withEstate({ 'plan-a': APPROVED }, {});
    expect(activeSprints(opts, null)).toEqual([]);
  });
});

describe('planStatusBySlug — reads plan.status, does not recompute it', () => {
  it('keys each working-tree plan by slug to its planStatus answer', () => {
    const opts = withEstate(
      { 'plan-app': APPROVED, 'plan-done': DELIVERED },
      {},
    );
    const map = planStatusBySlug(opts, null);
    expect(map.get('plan-app')).toBe('approved');
    expect(map.get('plan-done')).toBe('delivered');
  });
});
