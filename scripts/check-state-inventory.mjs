#!/usr/bin/env node
// EVERY STATE FILE A RUN WRITES IS DECLARED IN THE INVENTORY.
//
//   node scripts/check-state-inventory.mjs <root> [manifest]
//
// `<root>` is an `owned-run.sh` run root. The check lists every file under its
// three state bases — `home/.plot` (the run's `HOME/.plot`), `budget`
// (`PLOT_BUDGET_HOME`) and `pr-index` (`PLOT_PR_INDEX_HOME`) — and matches each
// path, relative to its base, against the globs in `scripts/state-inventory.json`.
// A path no glob of its base matches is printed with its base.
//
// Exit 0: every file is declared. Exit 1: at least one file is undeclared.
// Exit 2: the root or the manifest cannot be read, or an entry in the manifest
// does not carry exactly one bound from the vocabulary.
//
// A glob supports `*` (any characters within one path segment), `?` (one
// character within a segment) and `**` (any number of whole segments,
// including none). A base that does not exist holds no files.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASES = ['home/.plot', 'budget', 'pr-index'];

const BOUNDS = [
  'overwritten',
  'spent',
  'window',
  'rotated',
  'removed on exit',
  'removed with its desk',
  'kept on purpose',
  'tracked in git',
];

const here = path.dirname(fileURLToPath(import.meta.url));

const fail = (message) => {
  console.error(`check-state-inventory: ${message}`);
  process.exit(2);
};

const escapeRegex = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export const globToRegex = (glob) => {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
      if (glob[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}$`);
};

const readManifest = (file) => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`cannot read the manifest ${file}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) fail(`${file} has no "entries" array`);
  return parsed.entries.map((entry, index) => {
    const label = `entry ${index} (${entry?.glob ?? 'no glob'})`;
    if (!entry || typeof entry !== 'object') fail(`${label} is not an object`);
    if (!BASES.includes(entry.base)) fail(`${label} names base "${entry.base}", not one of: ${BASES.join(', ')}`);
    if (typeof entry.glob !== 'string' || entry.glob === '') fail(`${label} has no glob`);
    if (typeof entry.bound !== 'string' || !BOUNDS.includes(entry.bound)) {
      fail(`${label} carries bound ${JSON.stringify(entry.bound)}, which is not exactly one of: ${BOUNDS.join(', ')}`);
    }
    if (typeof entry.writer !== 'string' || entry.writer === '') fail(`${label} names no writer`);
    return { ...entry, regex: globToRegex(entry.glob) };
  });
};

// Every regular file under `dir`, as paths relative to it. A symlink is listed
// as a file and not followed.
const listFiles = (dir, rel = '') => {
  let names;
  try {
    names = readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' && rel === '') return [];
    fail(`cannot list ${path.join(dir, rel)}: ${err.message}`);
  }
  return names.flatMap((d) => {
    const child = rel === '' ? d.name : `${rel}/${d.name}`;
    return d.isDirectory() ? listFiles(dir, child) : [child];
  });
};

const main = () => {
  const [root, manifestArg] = process.argv.slice(2);
  if (!root) fail('usage: check-state-inventory.mjs <root> [manifest]');
  try {
    if (!statSync(root).isDirectory()) fail(`${root} is not a directory`);
  } catch (err) {
    fail(`cannot read the root ${root}: ${err.message}`);
  }
  const entries = readManifest(manifestArg ?? path.join(here, 'state-inventory.json'));

  const undeclared = BASES.flatMap((base) =>
    listFiles(path.join(root, base))
      .filter((rel) => !entries.some((e) => e.base === base && e.regex.test(rel)))
      .map((rel) => `${base}\t${rel}`),
  );

  if (undeclared.length === 0) return 0;
  console.error(`check-state-inventory: ${undeclared.length} state file(s) match no entry in the inventory:`);
  for (const line of undeclared) console.error(`  ${line}`);
  console.error('check-state-inventory: declare each in scripts/state-inventory.json with its bound and its writer.');
  return 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
