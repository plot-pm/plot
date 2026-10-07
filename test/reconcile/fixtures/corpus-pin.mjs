#!/usr/bin/env node
// The pin sequence `refs.corpus.test.ts`'s `beforeAll` runs, extracted so
// `corpus-pin-shared-repo.test.mjs` can kill it mid-flight and check what it
// left behind in the repository it was pointed at.
//
// Usage: node corpus-pin.mjs <repoRoot> <cloneDir>
//
// Deliberately NOT the real `refs.corpus.test.ts` — that file also runs the
// fleet scan, which is slow against a large repo and irrelevant to the
// property under test: whether anything here opens `repoRoot`'s own `.git`
// for a write. This is the clone/branch/config-edit sequence and nothing else.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [repoRoot, cloneDir] = process.argv.slice(2);
const PIN = 'plot-corpus-pin';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

execFileSync('git', ['clone', '--quiet', repoRoot, cloneDir], { encoding: 'utf8' });

// Printed the moment the clone finishes, so a caller times its kill from
// HERE rather than from process spawn — node's spawn-to-first-line latency
// varies by over 100ms, which otherwise races the clone instead of landing
// inside the sequence.
console.log('cloned');

// A deliberate pause between the clone and the branch/config writes, so a
// kill sent shortly after the clone completes lands reliably inside the
// sequence rather than racing a fast exit.
await new Promise((resolve) => setTimeout(resolve, 300));

const main = (() => {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().replace(/^origin\//, '');
  } catch {
    return 'main';
  }
})();

const head = git(cloneDir, 'rev-parse', `origin/${main}`);
git(cloneDir, 'branch', PIN, head);

const claudeMd = path.join(cloneDir, 'CLAUDE.md');
fs.writeFileSync(
  claudeMd,
  fs.readFileSync(claudeMd, 'utf8').replace(/^(## Plot Config\s*\n)/m, `$1- **Main branch:** ${PIN}\n`),
);

console.log(`pinned ${cloneDir} at ${head}`);
