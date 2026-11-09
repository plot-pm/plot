#!/usr/bin/env node
// The process-census gate: runs HEAD's census rows against HEAD's product and
// against the merge base's product, and compares the two reports.
//
//   census-gate.mjs --base <ref>     "before" is `git merge-base HEAD <ref>`
//   census-gate.mjs --before <sha>   "before" is <sha> (a push: the event's `before`)
//
//   --build <sh>   prepares the "before" worktree (default: pnpm install + build:board)
//   --run <sh>     runs the census rows from HEAD (default: the fleet's test:census)
//
// It stores no number: the "before" counts come from git, on every run. HEAD's
// product must already be built. Exits 1 when HEAD's census run fails or a
// count grew past its tolerance; the merge base's run may fail without effect.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeTree } from '../rm-tree.mjs';
import { CENSUS_PRODUCT_ENV, CENSUS_REPORT_ENV, compareCensus, readCensusReport } from './census-report.ts';

const DEFAULT_BUILD = 'pnpm install --frozen-lockfile && pnpm run build:board';
const DEFAULT_RUN = 'pnpm --filter @plot-pm/fleet run test:census';

const usage = (why) => {
  console.error(`census-gate: ${why}\nusage: census-gate.mjs (--base <ref> | --before <sha>) [--build <sh>] [--run <sh>]`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = { build: DEFAULT_BUILD, run: DEFAULT_RUN };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined || value === '') usage(`${flag} needs a value`);
    if (flag === '--base') opts.base = value;
    else if (flag === '--before') opts.before = value;
    else if (flag === '--build') opts.build = value;
    else if (flag === '--run') opts.run = value;
    else usage(`unknown argument ${flag}`);
  }
  if ((opts.base === undefined) === (opts.before === undefined)) usage('name exactly one of --base and --before');
  return opts;
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const sh = (cwd, command, env) => spawnSync('sh', ['-c', command], { cwd, env, stdio: 'inherit' }).status;

const main = () => {
  const opts = parseArgs(process.argv.slice(2));
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const before =
    opts.before !== undefined
      ? git(root, 'rev-parse', '--verify', `${opts.before}^{commit}`)
      : git(root, 'merge-base', 'HEAD', opts.base);
  const head = git(root, 'rev-parse', 'HEAD');
  const tmp = mkdtempSync(join(tmpdir(), 'plot-census-gate-'));
  const baseTree = join(tmp, 'before');
  let added = false;
  try {
    console.log(`census-gate: HEAD ${head}, before ${before}`);
    const headReport = join(tmp, 'head.jsonl');
    const baseReport = join(tmp, 'before.jsonl');
    const headStatus = sh(root, opts.run, { ...process.env, [CENSUS_REPORT_ENV]: headReport, [CENSUS_PRODUCT_ENV]: root });
    if (before === head) {
      console.log('census-gate: the "before" is HEAD itself; nothing to compare');
      return headStatus === 0 ? 0 : 1;
    }
    git(root, 'worktree', 'add', '--detach', baseTree, before);
    added = true;
    const built = sh(baseTree, opts.build, process.env);
    if (built !== 0) {
      console.log(`::warning::census-gate: building the "before" tree exited ${built}; every row reads "no before"`);
    } else {
      const status = sh(root, opts.run, { ...process.env, [CENSUS_REPORT_ENV]: baseReport, [CENSUS_PRODUCT_ENV]: baseTree });
      console.log(`census-gate: the census against the "before" tree exited ${status} (not gated)`);
    }
    const { ok, lines } = compareCensus(readCensusReport(baseReport), readCensusReport(headReport));
    if (lines.length === 0) console.log('census-gate: no census row recorded a count');
    for (const line of lines) console.log(line);
    if (headStatus !== 0) console.log(`census-gate: the census against HEAD exited ${headStatus}`);
    return ok && headStatus === 0 ? 0 : 1;
  } finally {
    if (added) spawnSync('git', ['worktree', 'remove', '--force', baseTree], { cwd: root, stdio: 'inherit' });
    removeTree(tmp);
  }
};

process.exitCode = main();
