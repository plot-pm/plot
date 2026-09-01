// Contract test for WHERE a delivery writes its `Delivered:` record.
//
// The plan template ends `## Status` with a commented-out block that shows the
// SHAPE of the transition records rather than any record:
//
//     <!-- Transition records — written by the workflow commands, not by hand:
//     - **Started:** <date>, <who>, <branch>   (one line per started branch)
//     -->
//
// Those `- **Started:**` lines are list items. `append_delivered_line` scanned
// `## Status` for the last list item and appended after it, so on any plan whose
// `Started:` records had been filled in — every plan that ran through
// `/plot-implement` — the record landed INSIDE the comment.
//
// THE FAILURE HAD NO SYMPTOM, which is why it needs a test and not just a fix.
// The phase still flipped, the push still succeeded, the summary still said
// `record=written`. But `plot-plan-meta.sh` reads the record from the document,
// not the comment, so it reported `delivered_raw: ""` for a plan delivered
// minutes earlier — and the script's already-done test is *the record is
// non-empty*, so a second run wrote a SECOND line into the comment rather than
// recognising its own work. Measured 2026-09-01 on
// `a-browser-test-serves-its-own-state`: two `Delivered:` lines in the comment,
// none in the plan.
//
// The assertion is the round trip, not the line number: deliver, then ask
// `plot-plan-meta.sh` what the plan says. Nothing here re-implements either
// side, so a fix that satisfies this test is a fix a reader of the plan sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliver = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');
const meta = path.resolve(here, '../../skills/plot/scripts/plot-plan-meta.sh');

/**
 * A whole repo with one plan, delivered for real.
 *
 * NOT `--dry-run`: the dry run prints what it WOULD write and never calls
 * `append_delivered_line`, so it cannot see this defect at all.
 *
 * AND IT NEEDS A REMOTE. The script does its writes in a booking worktree cut
 * from `origin/<default>` — one writer, so an interrupted run leaves the plan
 * untouched — and refuses outright when it cannot make one. A bare repo beside
 * the working copy is the cheapest honest remote: no network, no host CLI, and
 * the push under test is a local file copy. Measured while writing this file:
 * without it all four tests failed on *"could not prepare a booking worktree"*,
 * which is the script declining to work rather than the defect this asserts.
 *
 * The plan is read back from `origin/main` for the same reason `plot-deliver.sh`
 * and `plot-impl-status.sh` read it there: the working copy is not where the
 * record lands.
 */
const deliverAndRead = (statusBlock) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-record-'));
  const remote = `${dir}-remote.git`;
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
      '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
      + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n');
    const rel = path.join('docs', 'plans', '2026-01-01-recorded.md');
    // No `## Branches` section, so the gate finds nothing unmerged to refuse
    // and reaches the write. What is under test is the write, not the gate.
    fs.writeFileSync(path.join(dir, rel),
      `# A plan\n\n${statusBlock}\n## Changelog\n\n- Did a thing.\n`);
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
    execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);

    execFileSync('bash', [deliver, 'recorded'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    // Read what LANDED, and read it the way every consumer does.
    execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
    const text = execFileSync('git', ['-C', dir, 'show', `origin/main:${rel}`],
      { encoding: 'utf8' });
    const delivered = path.join(dir, 'read-back.md');
    fs.writeFileSync(delivered, text);
    const parsed = JSON.parse(
      execFileSync('bash', [meta, delivered], { cwd: dir, encoding: 'utf8' }));
    return { parsed, text };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }
};

const TEMPLATE_COMMENT = `<!-- Transition records — written by the workflow commands, not by hand:
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-01-01, T, \`feature/a\`
-->`;

test('the Delivered record lands where the parser reads it, not in the template comment', () => {
  const { parsed } = deliverAndRead(
    `## Status\n\n- **Phase:** Approved\n- **Approved:** 2026-01-01, T, in-session\n${TEMPLATE_COMMENT}\n`,
  );
  assert.equal(parsed.phase, 'delivered', 'the phase should flip');
  assert.notEqual(parsed.delivered_raw, '',
    'the plan reports no Delivered record — it was written into the template comment, '
    + 'where plot-plan-meta.sh cannot see it and a re-run cannot recognise it');
});

test('the record sits before the template comment, so a reader finds it with the others', () => {
  const { text } = deliverAndRead(
    `## Status\n\n- **Phase:** Approved\n- **Approved:** 2026-01-01, T, in-session\n${TEMPLATE_COMMENT}\n`,
  );
  const record = text.indexOf('- **Delivered:**');
  const comment = text.indexOf('<!-- Transition records');
  assert.ok(record > 0, 'no Delivered line was written at all');
  assert.ok(record < comment,
    'the Delivered line sits after the comment opens, so it is inside it');
});

test('it writes ONE record, however many times it runs', () => {
  // The already-done test is *the record is non-empty*, so a record the script
  // cannot read back is a record it writes again. Two runs, one line.
  const { text } = deliverAndRead(
    `## Status\n\n- **Phase:** Approved\n- **Approved:** 2026-01-01, T, in-session\n${TEMPLATE_COMMENT}\n`,
  );
  const lines = text.split('\n').filter((l) => /^\s*[-*]\s*\*\*Delivered:\*\*/.test(l));
  assert.equal(lines.length, 1, `expected one Delivered line, got ${lines.length}`);
});

test('an empty placeholder outside a comment is FILLED, not duplicated', () => {
  // The other arm of the same function, kept from regressing by the fix above:
  // a plan carrying `- **Delivered:**` with no value has its slot filled.
  const { parsed, text } = deliverAndRead(
    '## Status\n\n- **Phase:** Approved\n- **Approved:** 2026-01-01, T, in-session\n- **Delivered:**\n',
  );
  assert.notEqual(parsed.delivered_raw, '', 'the placeholder was not filled');
  const lines = text.split('\n').filter((l) => /^\s*[-*]\s*\*\*Delivered:\*\*/.test(l));
  assert.equal(lines.length, 1, 'the placeholder was appended to rather than filled');
});

// THE INLINE-COMMENT PLACEHOLDER, which is a different shape from both above.
//
// The template this repo ships ends `## Status` with a BLOCK comment, and the
// tests above cover it. Seven plans here instead carry the placeholder as a
// per-line comment:
//
//     - **Started:** <!-- YYYY-MM-DD, who, `branch` -->
//     - **Delivered:** <!-- YYYY-MM-DD -->
//     - **Released:** <!-- YYYY-MM-DD, version -->
//
// Both are legal, and `append_delivered_line` cannot tell them apart: it stops
// the moment it sees `<!--`, so on this shape it stops at the `Started:` line
// and never reaches the `Delivered:` slot one line below. The record is
// appended above the placeholders instead of filling one.
//
// THAT PART IS COSMETIC. What is not is the parser: `canon_delivered` takes the
// FIRST `Delivered:` line and calls `strip_placeholder` afterwards, so which of
// the two lines wins is decided by their ORDER. Today the record lands above
// the placeholder and the plan reads correctly; a record landing below it reads
// as `delivered_raw: ""` — a delivered plan the scan cannot see, which is the
// exact failure the block-comment fix above was written for, reached by another
// road.
//
// Measured 2026-09-01 on `a-machine-is-an-instance`: delivered, `Delivered:`
// record on line 10, placeholder on line 12, parsed correctly ONLY because of
// that ordering. Six more plans carry the shape and have not been delivered yet.
test('an inline-comment placeholder does not claim the Delivered slot', () => {
  const { parsed } = deliverAndRead(
    '## Status\n\n- **Phase:** Approved\n- **Approved:** 2026-01-01, T, in-session\n'
    + '- **Started:** <!-- YYYY-MM-DD, who, `branch` -->\n'
    + '- **Delivered:** <!-- YYYY-MM-DD -->\n'
    + '- **Released:** <!-- YYYY-MM-DD, version -->\n',
  );
  assert.equal(parsed.phase, 'delivered', 'the phase should flip');
  assert.notEqual(parsed.delivered_raw, '',
    'the plan reports no Delivered record — a placeholder took the slot, so a delivered '
    + 'plan is invisible to the scan exactly as it is when the record lands in a comment');
});

test('the parser reads the record whichever side of the placeholder it lands on', () => {
  // The ordering dependency stated directly, without going through the writer.
  // `started` already filters placeholders AT CAPTURE and so has never had this
  // bug; the scalar fields took the first line and stripped afterwards. This
  // asserts the property rather than today's lucky ordering — a writer that
  // ever appends below the placeholder must not silently empty the field.
  const read = (status) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-meta-order-'));
    const file = path.join(dir, '2026-01-01-ordering.md');
    fs.writeFileSync(file, `# Ordering\n\n${status}\n## Changelog\n`);
    const out = execFileSync(meta, [file], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    return JSON.parse(out);
  };
  const head = '- **Phase:** Delivered\n- **Type:** docs\n';
  const hole = '- **Delivered:** <!-- YYYY-MM-DD -->\n';
  const real = '- **Delivered:** 2026-09-01\n';

  assert.equal(read(`## Status\n\n${head}${real}${hole}`).delivered_raw, '2026-09-01',
    'record above the placeholder should be read');
  assert.equal(read(`## Status\n\n${head}${hole}${real}`).delivered_raw, '2026-09-01',
    'record below the placeholder is lost — the placeholder claimed the slot');
});
