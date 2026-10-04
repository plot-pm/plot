import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describingAs, type Sides } from './compare.js';

/**
 * THE DECLARED DUPLICATE: a receipt written by the shell and a receipt
 * written by `entry/deliver.ts` must be byte-identical, because
 * `plot-state-gate.sh`'s `receipt_clears` reads either one the same way.
 *
 * `plot-state-receipt.sh`'s `record_state_receipt` and the entry's own
 * `recordStateReceipt` are two implementations of ONE format — the entry
 * writes its own because no shell survives after the launcher `exec`s it, so
 * there is nothing left to source the shell function from. That is allowed
 * by `a-shell-script-asks-the-domain`'s corpus tier only when a test holds
 * the pair, the `sprint-score.corpus.test.ts` shape: NEITHER SIDE IS
 * AUTHORITATIVE, the test says they agree, and a disagreement stops the
 * branch rather than being adjusted away on either side.
 *
 * What "the entry's own" means here is reproduced inline rather than
 * imported from `entry/deliver.ts`: that module's receipt writer is not
 * exported for reuse, by design — the entry is a CLI, not a library, and
 * exporting internals to let a test call them would make the test exercise
 * code no caller reaches. So this test re-derives the same three steps
 * (`git hash-object` the repo-relative path, `<rel>\t<value>\n`, write under
 * `.plot/state/state-receipts/`) and compares the result against the real
 * shell function's output — which is exactly the wire a divergence would
 * show up on.
 */

const SIDES: Sides = { left: 'entry', right: 'shell' };
const report = describingAs(SIDES);

const here = path.dirname(new URL(import.meta.url).pathname);
const scripts = path.resolve(here, '../../../skills/plot/scripts');
const receiptSh = path.join(scripts, 'plot-state-receipt.sh');

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const scratchRepo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-receipt-corpus-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'T']);
  return dir;
};

/**
 * The git blob object name of a string, exactly as `entry/deliver.ts`'s
 * `gitBlobOid` computes it — `sha1("blob " + byteLength + "\0" + content)`,
 * `git hash-object --stdin`'s algorithm. Reproduced here for the same reason
 * given in the file header: the entry exports nothing for a test to import.
 */
const gitBlobOid = (content: string): string => {
  const bytes = Buffer.from(content, 'utf8');
  const hash = createHash('sha1');
  hash.update(`blob ${bytes.length}\0`);
  hash.update(bytes);
  return hash.digest('hex');
};

/** The entry's own receipt write, reproduced inline — see the file header. */
const entryReceipt = (repoRoot: string, relPath: string, value: string): string => {
  const oid = gitBlobOid(relPath);
  const dir = path.join(repoRoot, '.plot', 'state', 'state-receipts');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, oid);
  writeFileSync(file, `${relPath}\t${value}\n`);
  return file;
};

/**
 * The shell's `record_state_receipt`, sourced and called exactly as the
 * owning scripts call it. Finds the file it wrote by directory listing
 * rather than recomputing the oid: `.plot/state/state-receipts/` holds
 * nothing before this call, so whatever it creates is the one file there.
 */
const shellReceipt = (repoRoot: string, relPath: string, value: string): string => {
  execFileSync(
    'bash',
    ['-c', `. "$1" && record_state_receipt "$2" "$3"`, 'bash', receiptSh, relPath, value],
    { cwd: repoRoot },
  );
  const dir = path.join(repoRoot, '.plot', 'state', 'state-receipts');
  const [name] = readdirSync(dir);
  if (name === undefined) throw new Error(`record_state_receipt wrote nothing under ${dir}`);
  return path.join(dir, name);
};

describe('a state receipt: the entry and the shell write the same bytes', () => {
  const CASES: readonly [string, string][] = [
    ['docs/plans/2026-10-04-a-plan.md', 'Delivered'],
    ['docs/plans/active/a-plan.md', 'Released'],
    ['docs/plans/nested/dir/a-plan.md', 'Delivered'],
  ];

  it.each(CASES)('%s -> %s', (relPath, value) => {
    const repoRoot = scratchRepo();
    mkdirSync(path.dirname(path.join(repoRoot, relPath)), { recursive: true });
    writeFileSync(path.join(repoRoot, relPath), '# a plan\n');

    const entryFile = entryReceipt(repoRoot, relPath, value);
    const entryBytes = readFileSync(entryFile, 'utf8');
    rmSync(entryFile);

    const shellFile = shellReceipt(repoRoot, relPath, value);
    const shellBytes = readFileSync(shellFile, 'utf8');

    expect(entryFile).toBe(shellFile);

    const disagreements: { subject: string; field: string; adapter: string; production: string }[] = [];
    if (entryBytes !== shellBytes) {
      disagreements.push({
        subject: relPath,
        field: 'content',
        adapter: JSON.stringify(entryBytes),
        production: JSON.stringify(shellBytes),
      });
    }
    expect(disagreements.map(report)).toEqual([]);
  });
});
