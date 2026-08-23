// Flow tests: /plot-deliver's PR verification finds merged PRs by matching
// branch names to merged PR heads where a plan carries no `→ #N` annotation —
// the technique plot-reconcile-scan.sh already uses (section 2, signal B).
//
// What these prove BEYOND the reconcile unit tests: the DELIVERY path
// (plot-impl-status.sh, the helper /plot-deliver gates on) resolves an
// un-annotated branch through the SAME derivation, so the button that
// /plot-deliver backs works on a plan whose worker never annotated. The
// gate is NOT weakened: an unmerged branch is still reported unmerged.
//
// The host is asked through plot-host.sh only — the stub records gh argv, and
// the assertions read it to prove no direct gh call and the correct filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeSandbox, stubHost, runScript, instantiatePlan, recordApproval, sh,
} from './helpers.mjs';

// A gh stub that answers BOTH shapes plot-impl-status.sh may use:
//   - `pr view <n>`         → the annotated path (state by number)
//   - `pr list --state merged` → the branch-match path (heads to match)
// `merged` maps head branch name → PR number; `views` maps PR number → state.
// argv is recorded by the shared stubHost, so callers assert what ran.
function ghStub({ merged = {}, views = {} } = {}) {
  const mergedJson = JSON.stringify(
    Object.entries(merged).map(([head, number]) => ({ number, headRefName: head, title: head, state: 'MERGED' })),
  );
  const viewsJson = JSON.stringify(views);
  return stubHost(`
    const merged = ${mergedJson};
    const views = ${viewsJson};
    const j = (o) => process.stdout.write(JSON.stringify(o));
    if (argv.includes('list')) {
      // plot-host.sh pr-list runs: gh pr list --state <s> [--limit N] --json number,title,state,headRefName
      const wantMerged = argv.includes('merged');
      j(wantMerged ? merged : []);
    } else if (argv.includes('view')) {
      // gh pr view <ref> --json number,state,isDraft,url,mergeCommit
      const ref = argv[argv.indexOf('view') + 1];
      if (views[ref]) { j(views[ref]); }
      // A merged PR number (from the head-match path) resolves MERGED too, so
      // the re-confirm call in plot-impl-status.sh matches the list. The merged
      // value here is the pr-list ARRAY, so match on its members' numbers.
      else if (merged.some((p) => String(p.number) === String(ref))) {
        j({ number: Number(ref), state: 'MERGED', isDraft: false, url: 'u', mergeCommit: {} });
      } else {
        j({ number: 0, state: 'NONE', isDraft: false, url: '', mergeCommit: {} });
      }
    } else {
      process.stdout.write('{}');
    }
  `);
}

// Write a two-branch Branches section with the given annotations. `null`
// annotation means the branch line carries no `→ #N` at all.
function writeBranches(work, rel, lines) {
  const f = path.join(work, rel);
  let t = fs.readFileSync(f, 'utf8');
  const body = lines
    .map(([br, ann]) => `- \`${br}\` — the slice${ann ? ` → ${ann}` : ''}`)
    .join('\n');
  // Replace the template's own Branches body with ours.
  t = t.replace(/## Branches[\s\S]*?(?=\n## |\n<!--|$)/, `## Branches\n\n${body}\n\n`);
  fs.writeFileSync(f, t);
}

// ── Zero annotations, every branch merged → verifies via head-match ──────────
// The measured shape: a plan whose worker annotated nothing, whose branches all
// merged. plot-impl-status.sh must report both PRs MERGED without a single
// `→ #N` in the file — resolving each branch name against the merged-PR heads.
test('unannotated: all branches merged → both resolve MERGED by head-match', () => {
  const sb = makeSandbox({ name: 'del-unann', config: '- **Plan directory:** docs/plans/\n' });
  const stub = ghStub({ merged: { 'feature/one': 101, 'feature/two': 102 } });
  try {
    const rel = instantiatePlan(sb.work, { date: '2026-08-20', slug: 'unann', title: 'Unann', link: false });
    recordApproval(sb.work, rel, { channel: 'in-session' });
    writeBranches(sb.work, rel, [['feature/one', null], ['feature/two', null]]);
    sh(sb.work, 'git add -A && git commit -qm "plot: unann" && git push -q origin main');

    const status = JSON.parse(runScript('plot-impl-status.sh', ['unann'], { cwd: sb.work, stub }));
    assert.equal(status.prs.length, 2, 'both un-annotated branches must resolve');
    assert.deepEqual(status.prs.map((p) => p.state).sort(), ['MERGED', 'MERGED']);
    assert.deepEqual(status.prs.map((p) => p.number).sort(), [101, 102]);

    // Host asked through plot-host.sh only: gh ran `pr list --state merged`,
    // never a bare `gh pr view` for these branches (there were no annotations).
    const calls = stub.calls();
    assert.ok(calls.some((c) => c.includes('pr list') && c.includes('--state merged')),
      `expected a merged-PR list call, got: ${calls.join(' | ')}`);
  } finally {
    sb.cleanup();
  }
});

// ── One branch unmerged → the gate still refuses and names it ────────────────
// Matching must NOT weaken the gate. A branch with no merged PR head (and no
// annotation) is reported as unresolved — plot-impl-status.sh lists only what
// merged, so the /plot-deliver caller sees fewer PRs than branches and refuses.
test('unannotated: an unmerged branch does not fabricate a MERGED — gate holds', () => {
  const sb = makeSandbox({ name: 'del-hold', config: '- **Plan directory:** docs/plans/\n' });
  // only feature/one merged; feature/two has NO merged PR head
  const stub = ghStub({ merged: { 'feature/one': 201 } });
  try {
    const rel = instantiatePlan(sb.work, { date: '2026-08-20', slug: 'hold', title: 'Hold', link: false });
    recordApproval(sb.work, rel, { channel: 'in-session' });
    writeBranches(sb.work, rel, [['feature/one', null], ['feature/two', null]]);
    sh(sb.work, 'git add -A && git commit -qm "plot: hold" && git push -q origin main');

    const status = JSON.parse(runScript('plot-impl-status.sh', ['hold'], { cwd: sb.work, stub }));
    // feature/two must NOT appear as merged — only the one real merge resolves.
    const two = status.prs.find((p) => p.number === 202 || p.branch === 'feature/two');
    assert.equal(two, undefined, 'an unmerged branch must not be fabricated as MERGED');
    assert.ok(status.prs.every((p) => p.state === 'MERGED'),
      'only genuinely merged PRs are reported');
    assert.ok(status.prs.length < 2, 'fewer resolved PRs than branches → caller refuses');
  } finally {
    sb.cleanup();
  }
});

// ── Annotations, where present, still win ────────────────────────────────────
// A plan that DOES annotate behaves exactly as before: the `→ #N` is resolved
// by number via pr-state, and a cross-repo `owner/repo#N` (which head-match
// could never reach) still routes through --repo. Head-match is a fallback for
// the un-annotated line, never an override of an annotated one.
test('annotated: `→ #N` still resolves by number, unaffected by head-match', () => {
  const sb = makeSandbox({ name: 'del-ann', config: '- **Plan directory:** docs/plans/\n' });
  const stub = ghStub({
    // head-match would resolve feature/three to 999 — the annotation must win.
    merged: { 'feature/three': 999 },
    views: { 42: { number: 42, state: 'MERGED', isDraft: false, url: 'u', mergeCommit: {} } },
  });
  try {
    const rel = instantiatePlan(sb.work, { date: '2026-08-20', slug: 'ann', title: 'Ann', link: false });
    recordApproval(sb.work, rel, { channel: 'in-session' });
    writeBranches(sb.work, rel, [['feature/three', '#42']]);
    sh(sb.work, 'git add -A && git commit -qm "plot: ann" && git push -q origin main');

    const status = JSON.parse(runScript('plot-impl-status.sh', ['ann'], { cwd: sb.work, stub }));
    assert.equal(status.prs.length, 1);
    assert.equal(status.prs[0].number, 42, 'the annotation wins over the head-match');
    assert.equal(status.prs[0].state, 'MERGED');
    assert.ok(stub.calls().some((c) => c.includes('pr view 42')),
      'annotated branch resolves by number via pr-state');
  } finally {
    sb.cleanup();
  }
});
