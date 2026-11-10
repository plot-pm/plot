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
// With neither --only nor --compare, one process runs both halves, HEAD first:
// a failed census against HEAD returns before the merge base's worktree is
// added. CI runs the halves as parallel jobs instead:
//
//   census-gate.mjs --only head --report <file>
//       the census against HEAD; writes the report; exits 1 when the run fails
//   census-gate.mjs --only before (--base <ref> | --before <sha>) --report <file>
//       the census against the "before" product; writes the report; never gated
//   census-gate.mjs --compare <head report> <before report>
//       compares two reports; a missing "before" report reads "no before"
//
// It stores no number: the "before" counts come from git, on every run. HEAD's
// product must already be built. Exits 1 when HEAD's census run fails or a
// count grew past its tolerance; the merge base's run may fail without effect.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { removeTree } from '../rm-tree.mjs';
import { CENSUS_PRODUCT_ENV, CENSUS_REPORT_ENV, compareCensus, readCensusReport } from './census-report.ts';

const DEFAULT_BUILD = 'pnpm install --frozen-lockfile && pnpm run build:board';
const DEFAULT_RUN = 'pnpm --filter @plot-pm/fleet run test:census';

const USAGE =
  'usage: census-gate.mjs (--base <ref> | --before <sha>) [--build <sh>] [--run <sh>]\n' +
  '       census-gate.mjs --only head --report <file> [--run <sh>]\n' +
  '       census-gate.mjs --only before (--base <ref> | --before <sha>) --report <file> [--build <sh>] [--run <sh>]\n' +
  '       census-gate.mjs --compare <head report> <before report>';

const usage = (why) => {
  console.error(`census-gate: ${why}\n${USAGE}`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = { build: DEFAULT_BUILD, run: DEFAULT_RUN };
  for (let i = 0; i < argv.length; ) {
    const flag = argv[i];
    if (flag === '--compare') {
      const [head, before] = [argv[i + 1], argv[i + 2]];
      if (!head || !before) usage('--compare needs a HEAD report and a "before" report');
      opts.compare = { head, before };
      i += 3;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value === '') usage(`${flag} needs a value`);
    if (flag === '--base') opts.base = value;
    else if (flag === '--before') opts.before = value;
    else if (flag === '--build') opts.build = value;
    else if (flag === '--run') opts.run = value;
    else if (flag === '--only') {
      if (value !== 'head' && value !== 'before') usage('--only takes head or before');
      opts.only = value;
    } else if (flag === '--report') opts.report = value;
    else usage(`unknown argument ${flag}`);
    i += 2;
  }
  if (opts.compare) {
    if (opts.only || opts.base || opts.before || opts.report) usage('--compare takes no other half or report argument');
    return opts;
  }
  if (opts.only && !opts.report) usage(`--only ${opts.only} needs --report <file>`);
  if (!opts.only && opts.report) usage('--report needs --only');
  if (opts.only === 'head') {
    if (opts.base !== undefined || opts.before !== undefined) usage('--only head compares nothing and takes neither --base nor --before');
    return opts;
  }
  if ((opts.base === undefined) === (opts.before === undefined)) usage('name exactly one of --base and --before');
  return opts;
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const sh = (cwd, command, env) => spawnSync('sh', ['-c', command], { cwd, env, stdio: 'inherit' }).status;

const printComparison = (baseReport, headReport) => {
  const { ok, lines } = compareCensus(readCensusReport(baseReport), readCensusReport(headReport));
  if (lines.length === 0) console.log('census-gate: no census row recorded a count');
  for (const line of lines) console.log(line);
  return ok;
};

const resolveBefore = (root, opts) =>
  opts.before !== undefined ? git(root, 'rev-parse', '--verify', `${opts.before}^{commit}`) : git(root, 'merge-base', 'HEAD', opts.base);

/** Builds the "before" tree and runs HEAD's rows against it. Returns false when the build failed. */
const runBefore = (root, tmp, opts, before, report) => {
  const baseTree = join(tmp, 'before');
  git(root, 'worktree', 'add', '--detach', baseTree, before);
  try {
    const built = sh(baseTree, opts.build, process.env);
    if (built !== 0) {
      console.log(`::warning::census-gate: building the "before" tree exited ${built}; every row reads "no before"`);
      return false;
    }
    const status = sh(root, opts.run, { ...process.env, [CENSUS_REPORT_ENV]: report, [CENSUS_PRODUCT_ENV]: baseTree });
    console.log(`census-gate: the census against the "before" tree exited ${status} (not gated)`);
    return true;
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', baseTree], { cwd: root, stdio: 'inherit' });
  }
};

const main = () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.compare) return printComparison(opts.compare.before, opts.compare.head) ? 0 : 1;
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const head = git(root, 'rev-parse', 'HEAD');
  const tmp = mkdtempSync(join(tmpdir(), 'plot-census-gate-'));
  try {
    if (opts.only === 'head') {
      console.log(`census-gate: HEAD ${head}`);
      const status = sh(root, opts.run, { ...process.env, [CENSUS_REPORT_ENV]: resolve(opts.report), [CENSUS_PRODUCT_ENV]: root });
      if (status !== 0) console.log(`census-gate: the census against HEAD exited ${status}`);
      return status === 0 ? 0 : 1;
    }
    const before = resolveBefore(root, opts);
    console.log(`census-gate: HEAD ${head}, before ${before}`);
    if (opts.only === 'before') {
      if (before === head) console.log('census-gate: the "before" is HEAD itself; nothing to compare');
      else runBefore(root, tmp, opts, before, resolve(opts.report));
      return 0;
    }
    const headReport = join(tmp, 'head.jsonl');
    const baseReport = join(tmp, 'before.jsonl');
    const headStatus = sh(root, opts.run, { ...process.env, [CENSUS_REPORT_ENV]: headReport, [CENSUS_PRODUCT_ENV]: root });
    if (headStatus !== 0) {
      console.log(`census-gate: the census against HEAD exited ${headStatus}; the merge base is not run`);
      return 1;
    }
    if (before === head) {
      console.log('census-gate: the "before" is HEAD itself; nothing to compare');
      return 0;
    }
    runBefore(root, tmp, opts, before, baseReport);
    return printComparison(baseReport, headReport) ? 0 : 1;
  } finally {
    removeTree(tmp);
  }
};

process.exitCode = main();
