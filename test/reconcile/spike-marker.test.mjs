// A slice is marked spike: plot-plan-meta.sh reads the marker in both slice
// dialects, the `Tracer: yes` line and the `Spike approved:` record, and
// reports each as absent rather than false when the plan names none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const parser = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-plan-meta.sh');

const parseSource = (src) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-spike-marker-'));
  const f = path.join(dir, '2026-10-12-fixture.md');
  writeFileSync(f, src);
  try {
    return JSON.parse(execFileSync('bash', [parser, f], { encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const plan = (slices, status = '') => `# Fixture

## Status

- **State:** Approved
- **Type:** feature
${status}
## Slices

${slices}
`;

test('plan-meta: a list branch line carrying the spike comment is flagged, its neighbour is not', () => {
  const meta = parseSource(plan('- `feature/a` — the spike <!-- spike -->\n- `feature/b` — the rest\n'));
  const [a, b] = meta.waves[0].branches;
  assert.equal(a.spike, true);
  assert.equal('spike' in b, false, 'absent, not false');
});

test('plan-meta: a Branch: heading carrying the spike comment is flagged', () => {
  const meta = parseSource(plan('### The spike (Branch: `feature/a`) <!-- spike -->\n\nWork.\n\n### The rest (Branch: `feature/b`)\n\nWork.\n'));
  const flagged = meta.waves.flatMap((w) => w.branches).filter((b) => b.spike === true).map((b) => b.branch);
  assert.deepEqual(flagged, ['feature/a']);
});

test('plan-meta: Tracer: yes and the Spike approved: record are read from Status', () => {
  const meta = parseSource(plan('- `feature/a` — x\n', '- **Tracer:** yes\n- **Spike approved:** 2026-10-12, jwloka\n'));
  assert.equal(meta.tracer, true);
  assert.equal(meta.spike_approved_raw, '2026-10-12, jwloka');
});

test('plan-meta: a plain plan reports no tracer, no spike flag and an empty record', () => {
  const meta = parseSource(plan('- `feature/a` — x\n'));
  assert.equal('tracer' in meta, false);
  assert.equal(meta.spike_approved_raw, '');
  assert.equal('spike' in meta.waves[0].branches[0], false);
});
