import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSprintFile, collectSprints } from '../../src/server/board.js';

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
  it("reads this repo's own W35 file: 19 distinct plans, each with slug and tier", () => {
    // The case the whole plan exists for. The W35 file lists 22 checkbox lines,
    // but `the-wave-is-a-thing-the-board-can-hold` appears four times (one line
    // per wave), so the sprint contains 19 distinct plans.
    const abs = path.resolve(
      __dirname,
      '../../../../docs/sprints/2026-W35-the-board-tells-the-truth-in-every-section.md',
    );
    const card = parseSprintFile(abs);
    expect(card).not.toBeNull();
    const members = card!.members;
    expect(members).toHaveLength(19);
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

  it('parses both `- [ ]` and `- [x]` — a ticked item is still a member', () => {
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [open-one] open\n- [x] [done-one] ticked\n`,
    );
    const card = parseSprintFile(abs)!;
    expect(card.members.map((m) => m.slug)).toEqual(['open-one', 'done-one']);
    expect(card.members.find((m) => m.slug === 'done-one')?.checked).toBe(true);
    expect(card.members.find((m) => m.slug === 'open-one')?.checked).toBe(false);
  });

  it('distinguishes `### Deferred` items from Must/Should/Could', () => {
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

  it('a `### Deferred` line under prose (not a checkbox) is not a member', () => {
    // The W35 file's Deferred section is prose bullets, not `- [ ] [slug]`; only
    // checkbox members are read.
    const abs = writeSprint(
      `# Sprint: Fixture\n\n${STATUS}\n### Deferred\n\n- **Renaming Endgame.** prose, no slug\n`,
    );
    expect(parseSprintFile(abs)!.members).toEqual([]);
  });

  it('a sprint file with no members yields an empty list, not an error', () => {
    const abs = writeSprint(`# Sprint: Empty\n\n${STATUS}\n## Notes\n\nnothing here\n`);
    const card = parseSprintFile(abs)!;
    expect(card.members).toEqual([]);
  });

  it('dedupes a slug repeated across waves to one member, first tier wins', () => {
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

  it('marks every parsed member known:true — the file cannot tell what exists', () => {
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

  it('flags a member whose slug matches no known plan, keeping it in the list', () => {
    const { repoRoot, sprintDir } = withSprintDir(
      '2026-W40-fixture.md',
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [real-plan] here\n- [ ] [ghost-plan] renamed away\n`,
    );
    const sprints = collectSprints(repoRoot, sprintDir, new Set(['real-plan']));
    expect(sprints).toHaveLength(1);
    const byslug = Object.fromEntries(sprints[0].members.map((m) => [m.slug, m]));
    // The ghost is present, flagged — never silently absent.
    expect(byslug['ghost-plan']).toBeDefined();
    expect(byslug['ghost-plan'].known).toBe(false);
    expect(byslug['real-plan'].known).toBe(true);
  });

  it('leaves every member known when no plan set is supplied (back-compat)', () => {
    const { repoRoot, sprintDir } = withSprintDir(
      '2026-W40-fixture.md',
      `# Sprint: Fixture\n\n${STATUS}\n### Must Have\n\n- [ ] [any] x\n`,
    );
    const sprints = collectSprints(repoRoot, sprintDir);
    expect(sprints[0].members[0].known).toBe(true);
  });
});
