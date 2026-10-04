// Contract test for the state and action receipts a delivery leaves behind,
// since `the-first-script-becomes-a-command` moved their write from shell
// (sourced from plot-state-receipt.sh) into entry/deliver.ts's own
// `recordStateReceipt`/`spendActionReceipt`.
//
// TWO PROPERTIES THE RECEIPT CONTRACT DEPENDS ON:
//
//   - A REFUSED run leaves NO state receipt. `plot-state-gate.sh` refuses any
//     writer of a `State:` line with no matching receipt, so a receipt written
//     before a refused write would license a commit of a state that was never
//     reached — the exact failure `the-master-agent-uses-the-controllers`
//     names as the gate's reason to exist.
//   - The action receipt is spent ONLY on exit 0. An interrupted run (a
//     rejected push, for instance) must keep its licence so re-running is
//     still the repair `plot-deliver.sh`'s header documents for every
//     interruption after the irreversible push.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const deliver = path.resolve(here, '../../skills/plot/scripts/plot-deliver.sh');
const receiptSh = path.resolve(here, '../../skills/plot/scripts/plot-state-receipt.sh');

/** The git blob oid of a string, `git hash-object --stdin`'s algorithm. */
const gitBlobOid = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  const hash = createHash('sha1');
  hash.update(`blob ${bytes.length}\0`);
  hash.update(bytes);
  return hash.digest('hex');
};

const stateReceiptFile = (dir, relPath) =>
  path.join(dir, '.plot', 'state', 'state-receipts', gitBlobOid(relPath));

const actionReceiptFile = (dir, action) => path.join(dir, '.plot', 'state', 'action-receipts', action);

// Every path this file creates: the directory `mkdtempSync` returned and the
// bare remote beside it. Removed by exact path, never by a glob.
const made = [];
after(() => {
  for (const p of made) fs.rmSync(p, { recursive: true, force: true });
});

/** A whole repo with one plan, the shape the deliver-phase tests already use. */
const makeRepo = (planBody, { rejectPush = false } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-receipt-'));
  const remote = `${dir}-remote.git`;
  made.push(dir, remote);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** docs/plans/\n'
      + '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n',
  );
  const rel = path.join('docs', 'plans', '2026-01-01-receipted.md');
  fs.writeFileSync(path.join(dir, rel), planBody);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'plan']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
  execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main']);
  execFileSync('git', ['-C', dir, 'fetch', '-q', 'origin']);
  if (rejectPush) {
    const hook = path.join(remote, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho "protected" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
  }
  return { dir, remote, rel };
};

const run = (dir, args) => {
  try {
    const out = execFileSync('bash', [deliver, ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
};

test('a REFUSED run (no ## Status section) leaves no state receipt', () => {
  const { dir, rel } = makeRepo('# A plan\n\nNo status section at all.\n');
  const r = run(dir, ['receipted']);
  assert.equal(r.code, 1, r.out);
  assert.equal(fs.existsSync(stateReceiptFile(dir, rel)), false, 'a refused run must write no receipt');
});

test('a plan not yet approved refuses before any write, leaving no receipt', () => {
  const { dir, rel } = makeRepo(['## Status', '', '- **State:** Draft', ''].join('\n'));
  const r = run(dir, ['receipted']);
  assert.equal(r.code, 1, r.out);
  assert.equal(fs.existsSync(stateReceiptFile(dir, rel)), false);
});

test('a completed delivery writes a state receipt that the shell reader clears', () => {
  const { dir, rel } = makeRepo(['## Status', '', '- **State:** Approved', ''].join('\n'));
  const r = run(dir, ['receipted']);
  assert.equal(r.code, 0, r.out);
  const file = stateReceiptFile(dir, rel);
  assert.equal(fs.existsSync(file), true, 'a completed delivery must leave a state receipt');
  assert.equal(fs.readFileSync(file, 'utf8'), `${rel}\tDelivered\n`);

  // THE GATE'S OWN READER CLEARS IT — not a re-derivation of its format. A
  // receipt only the entry can read would be a receipt `plot-state-gate.sh`
  // could never clear.
  const cleared = execFileSync(
    'bash',
    ['-c', '. "$1" && receipt_clears "$2" "$3" && echo cleared', 'bash', receiptSh, rel, 'Delivered'],
    { cwd: dir, encoding: 'utf8' },
  ).trim();
  assert.equal(cleared, 'cleared');
});

test('a completed delivery spends the action receipt; an interrupted run keeps its licence', () => {
  // THE COMPLETED CASE, first: the action receipt must be gone after exit 0.
  const ok = makeRepo(['## Status', '', '- **State:** Approved', ''].join('\n'));
  execFileSync(
    'bash',
    ['-c', '. "$1" && record_action_receipt "$2" "$3"', 'bash', receiptSh, 'plot-deliver.sh', 'receipted'],
    { cwd: ok.dir },
  );
  assert.equal(fs.existsSync(actionReceiptFile(ok.dir, 'deliver')), true, 'setup: the receipt must exist before the run');
  const r = run(ok.dir, ['receipted']);
  assert.equal(r.code, 0, r.out);
  assert.equal(
    fs.existsSync(actionReceiptFile(ok.dir, 'deliver')),
    false,
    'a completed run must spend its action receipt',
  );

  // THE INTERRUPTED CASE: a push rejected by branch protection must leave the
  // action receipt untouched, because re-running is the documented repair.
  const rejected = makeRepo(['## Status', '', '- **State:** Approved', ''].join('\n'), { rejectPush: true });
  execFileSync(
    'bash',
    ['-c', '. "$1" && record_action_receipt "$2" "$3"', 'bash', receiptSh, 'plot-deliver.sh', 'receipted'],
    { cwd: rejected.dir },
  );
  const r2 = run(rejected.dir, ['receipted']);
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /push=rejected/);
  assert.equal(
    fs.existsSync(actionReceiptFile(rejected.dir, 'deliver')),
    true,
    'an interrupted run must keep its action receipt — re-running is the repair',
  );
});
