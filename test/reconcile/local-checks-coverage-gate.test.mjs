// Every scripts/check-*.sh gate CI runs must be in CLAUDE.md's `Local checks`,
// or be declared here as CI-only with a reason. A fleet agent runs exactly what
// plot-local-checks.mjs prints, so a gate missing there is learned one CI round trip late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// gate basename -> why it cannot run locally
const CI_ONLY = {
  'check-host-https-callers.sh':
    'github-reads-in-process names it a CI gate and adds no Local checks entry; its contract test runs locally with the gate tests',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = /scripts\/(check-[\w-]+\.sh)/g;
const gatesIn = (text) => new Set([...text.matchAll(GATE)].map((m) => m[1]));

const ciGates = () => {
  const lines = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .map((l) => l.replace(/\s#.*$/, ''));
  return gatesIn(lines.join('\n'));
};

const localGates = () => {
  const line = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('- **Local checks:**'));
  assert.ok(line, 'CLAUDE.md has no Local checks key');
  return gatesIn(line);
};

test('every CI check-*.sh gate is in Local checks or declared CI-only', () => {
  const local = localGates();
  const missing = [...ciGates()].filter((g) => !local.has(g) && !(CI_ONLY[g] || '').trim());
  assert.deepEqual(missing, [], `CI runs these gates but Local checks omits them: ${missing.join(', ')}`);
});

test('a CI_ONLY entry names a gate CI runs and Local checks omits, with a reason', () => {
  const ci = ciGates();
  const local = localGates();
  for (const [gate, reason] of Object.entries(CI_ONLY)) {
    assert.ok(typeof reason === 'string' && reason.trim(), `${gate} has no reason`);
    assert.ok(ci.has(gate), `${gate} is declared CI-only but CI does not run it`);
    assert.ok(!local.has(gate), `${gate} is declared CI-only but Local checks lists it`);
  }
});
