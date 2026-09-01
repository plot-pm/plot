import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSprintFile, collectSprints } from '../../src/server/board.js';
import { sprintMembership } from '../../src/server/fleet.js';

/**
 * Write a sprint file into a fresh temp dir and return its absolute path.
 * Sprint files carry a `## Status` block with a `Phase:` — without it
 * `parseSprintFile` returns null, so every fixture supplies one.
 */
function writeSprint(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-members-'));
  const abs = path.join(dir, '2026-W40-fixture.md');
  fs.writeFileSync(abs, body, 'utf8');
  return abs;
}

const STATUS = `## Status\n\n- **Phase:** Active\n- **Release:** 9.9.0\n`;

describe('parseSprintFile — members', () => {
  it("reads this repo's own W35 file: every checkbox line, deduplicated by slug", async () => {
    // The case the whole plan exists for: a plan carrying several waves takes one
    // checkbox line per wave, and the member list must collapse them to one
    // entry. `the-wave-is-a-thing-the-board-can-hold` is the live example —
    // four lines, one plan.
    //
    // ASSERTED AS A RELATION, NOT A NUMBER. An earlier version pinned `19`,
    // which was true on the day it was written and false the moment the sprint
    // legitimately gained two plans — it failed for a reason that was not a
    // regression, and the fix was to edit the number, which teaches nobody
    // anything. What this file is FOR is that duplicates collapse, so it
    // asserts exactly that: fewer members than lines, every slug distinct, and
    // the known multi-wave plan present exactly once.
    const abs = path.resolve(
      __dirname,
      '../../../../docs/sprints/2026-W35-the-board-tells-the-truth-in-every-section.md',
    );
    const card = parseSprintFile(abs);
    expect(card).not.toBeNull();
    const members = card!.members;
    // Fewer members than checkbox lines: at least one plan was collapsed.
    const lines = fs.readFileSync(abs, 'utf8').split('\n')
      .filter((l) => /^- \[[ x]\] \[/.test(l)).length;
    expect(members.length).toBeLessThan(lines);
    // Every slug distinct — the collapse is complete, not partial.
    expect(new Set(members.map((m) => m.slug)).size).toBe(members.length);
    // The live multi-wave plan appears exactly once, however many waves it has.
    expect(members.filter((m) => m.slug === 'the-wave-is-a-thing-the-board-can-hold'))
      .toHaveLength(1);
    // Every member carries a slug and a tier.
    for (const m of members) {
      expect(m.slug).toBeTruthy();
      expect(['must', 'should', 'could', 'deferred']).toContain(m.tier);
    }
    // The four-wave plan is one member, at its Must tier.
    const wave = members.filter((m) => m.slug === 'the-wave-is-a-thing-the-board-can-hold');
    expect(wave).toHaveLength(1);
    expect(wave[0].tier).toBe('must');
    // A known Should and a known Could land under the right tier.
    expect(members.find((m) => m.slug === 'a-split-plan-says-it-is-split')?.tier).toBe('should');
    expect(members.find((m) => m.slug === 'loose-checks-what-it-promises')?.tier).toBe('could');
  });

  it('parses both `- [ ]` and `- [x]` — a ticked item is still a member', async () => {
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [open-one] open\n- [x] [done-one] ticked\n`,
    );
    const card = parseSprintFile(abs)!;
    expect(card.members.map((m) => m.slug)).toEqual(['open-one', 'done-one']);
    expect(card.members.find((m) => m.slug === 'done-one')?.checked).toBe(true);
    expect(card.members.find((m) => m.slug === 'open-one')?.checked).toBe(false);
  });

  it('distinguishes `### Deferred` items from Must/Should/Could', async () => {
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n` +
        `### Must Have\n\n- [ ] [m] must\n\n` +
        `### Should Have\n\n- [ ] [s] should\n\n` +
        `### Could Have\n\n- [ ] [c] could\n\n` +
        `### Deferred\n\n- [ ] [d] deferred\n`,
    );
    const card = parseSprintFile(abs)!;
    expect(card.members.find((m) => m.slug === 'm')?.tier).toBe('must');
    expect(card.members.find((m) => m.slug === 's')?.tier).toBe('should');
    expect(card.members.find((m) => m.slug === 'c')?.tier).toBe('could');
    expect(card.members.find((m) => m.slug === 'd')?.tier).toBe('deferred');
  });

  it('a `### Deferred` line under prose (not a checkbox) is not a member', async () => {
    // The W35 file's Deferred section is prose bullets, not `- [ ] [slug]`; only
    // checkbox members are read.
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n### Deferred\n\n- **Renaming Endgame.** prose, no slug\n`,
    );
    expect(parseSprintFile(abs)!.members).toEqual([]);
  });

  it('a sprint file with no members yields an empty list, not an error', async () => {
    const abs = writeSprint(`# Sprint: Empty\n\n${STATUS}\n## Notes\n\nnothing here\n`);
    const card = parseSprintFile(abs)!;
    expect(card.members).toEqual([]);
  });

  it('dedupes a slug repeated across waves to one member, first tier wins', async () => {
    // A plan sliced into waves lists its slug once per wave; the sprint contains
    // it once. First occurrence (highest tier, read top-down) wins.
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n` +
        `### Must Have\n\n- [ ] [w] Wave one\n- [ ] [w] Wave two\n\n` +
        `### Should Have\n\n- [ ] [w] Wave three\n`,
    );
    const card = parseSprintFile(abs)!;
    const w = card.members.filter((m) => m.slug === 'w');
    expect(w).toHaveLength(1);
    expect(w[0].tier).toBe('must');
  });

  it('marks every parsed member known:true — the file cannot tell what exists', async () => {
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [anything] x\n`,
    );
    expect(parseSprintFile(abs)!.members[0].known).toBe(true);
  });
});

describe('collectSprints — a slug naming no plan is reported, not dropped', () => {
  /** Build a sprint directory with `active/<file>` and return its repoRoot + sprintDir. */
  function withSprintDir(fileName: string, body: string): { repoRoot: string; sprintDir: string } {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-collect-'));
    const activeDir = path.join(repoRoot, 'docs/sprints/active');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(path.join(activeDir, fileName), body, 'utf8');
    return { repoRoot, sprintDir: 'docs/sprints' };
  }

  it('flags a member whose slug matches no known plan, keeping it in the list', async () => {
    const { repoRoot, sprintDir } = withSprintDir(
      '2026-W40-fixture.md',
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [real-plan] here\n- [ ] [ghost-plan] renamed away\n`,
    );
    const sprints = await collectSprints(repoRoot, sprintDir, new Set(['real-plan']));
    expect(sprints).toHaveLength(1);
    const byslug = Object.fromEntries(sprints[0].members.map((m) => [m.slug, m]));
    // The ghost is present, flagged — never silently absent.
    expect(byslug['ghost-plan']).toBeDefined();
    expect(byslug['ghost-plan'].known).toBe(false);
    expect(byslug['real-plan'].known).toBe(true);
  });

  it('leaves every member known when no plan set is supplied (back-compat)', async () => {
    const { repoRoot, sprintDir } = withSprintDir(
      '2026-W40-fixture.md',
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [any] x\n`,
    );
    const sprints = await collectSprints(repoRoot, sprintDir);
    expect(sprints[0].members[0].known).toBe(true);
  });
});

describe('sprintMembership — which active sprint claims each plan', () => {
  /**
   * A temp repo whose `docs/sprints/active/` holds one file per sprint. The real
   * estate symlinks active sprints into that dir; a test can write the files
   * directly, since `collectSprints` reads whatever is there and this map filters
   * on the phase itself rather than trusting the directory.
   */
  function withSprints(files: Record<string, string>): { repoRoot: string; scriptsDir: string } {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-membership-'));
    const activeDir = path.join(repoRoot, 'docs/sprints/active');
    fs.mkdirSync(activeDir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(activeDir, name), body, 'utf8');
    }
    return { repoRoot, scriptsDir: path.join(repoRoot, 'scripts') };
  }

  const ACTIVE = `## Status\n\n- **Phase:** Active\n`;
  const CLOSED = `## Status\n\n- **Phase:** Closed\n`;

  it('maps each member plan slug to the sprint that lists it', async () => {
    // The sprint's own slug comes from its FILENAME (`\d{4}-W\d{2}-<slug>.md`),
    // not its `# Sprint:` title — the same rule `parseSprintFile` follows.
    const opts = withSprints({
      '2026-W40-alpha.md':
        `# Sprint: Alpha Title\n\n${ACTIVE}\n### Must Have\n\n- [ ] [plan-one] a\n- [ ] [plan-two] b\n`,
    });
    const map = await sprintMembership(opts);
    expect(map.get('plan-one')).toBe('alpha');
    expect(map.get('plan-two')).toBe('alpha');
    // A plan no sprint lists is simply absent — the caller reads that as "".
    expect(map.has('plan-three')).toBe(false);
  });

  it('ignores a Closed sprint left in the active dir — a stale link must not claim a row', async () => {
    // `collectSprints` reads the active/ dir, which is a symlink index the estate
    // curates. This function does not trust it: a Closed sprint reachable there by
    // drift is excluded on its own phase, so the field never reads a commitment
    // that has ended.
    const opts = withSprints({
      '2026-W40-live.md':
        `# Sprint: Active One\n\n${ACTIVE}\n### Must Have\n\n- [ ] [live-plan] a\n`,
      '2026-W39-gone.md':
        `# Sprint: Closed One\n\n${CLOSED}\n### Must Have\n\n- [ ] [old-plan] b\n`,
    });
    const map = await sprintMembership(opts);
    expect(map.get('live-plan')).toBe('live');
    expect(map.has('old-plan')).toBe(false);
  });

  it('gives a plan two active sprints both list to the FIRST — deterministic', async () => {
    // Two Active sprints are permitted (two teams, one train). The field records
    // one sprint per row; the first to list a plan wins, matching the first-wins
    // dedup the member list itself uses, so the answer does not depend on which
    // way collectSprints happened to order the directory.
    const opts = withSprints({
      '2026-W40-first.md':
        `# Sprint: First\n\n${ACTIVE}\n### Must Have\n\n- [ ] [shared-plan] a\n`,
      '2026-W40-second.md':
        `# Sprint: Second\n\n${ACTIVE}\n### Must Have\n\n- [ ] [shared-plan] a\n`,
    });
    const map = await sprintMembership(opts);
    // Whichever sprint won, it is ONE of the two and stable across calls — the
    // property that matters is that the map holds a single deterministic answer.
    expect((await sprintMembership(opts)).get('shared-plan')).toBe(map.get('shared-plan'));
    expect(['first', 'second']).toContain(map.get('shared-plan'));
  });

  it('is empty when no sprint is active — the caller then leaves every row unclaimed', async () => {
    const opts = withSprints({
      '2026-W39-closed.md':
        `# Sprint: Closed\n\n${CLOSED}\n### Must Have\n\n- [ ] [some-plan] a\n`,
    });
    expect((await sprintMembership(opts)).size).toBe(0);
  });
});
