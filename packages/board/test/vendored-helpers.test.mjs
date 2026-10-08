// The prune build.mjs runs before its copy loop (#1344): a stray
// `plot-*.sh` copy at the package root survives a name leaving
// `vendoredScripts` because the copy loop only ever adds. These assert the
// four ways a naive "delete every plot-*.sh" prune goes wrong.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneStaleVendoredHelpers } from '../vendored-helpers.mjs';
import { rmTree } from './helpers.mjs';

describe('pruneStaleVendoredHelpers', () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmTree(dir);
  });

  const makeDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-vendored-'));
    dirs.push(dir);
    return dir;
  };

  it('removes a stray not in the keep-set and leaves a kept name', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'plot-gone.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(dir, 'plot-config.sh'), '#!/bin/sh\n');

    const removed = pruneStaleVendoredHelpers(dir, ['plot-config.sh']);

    assert.deepEqual(removed, ['plot-gone.sh']);
    assert.equal(fs.existsSync(path.join(dir, 'plot-gone.sh')), false);
    assert.equal(fs.existsSync(path.join(dir, 'plot-config.sh')), true);
  });

  it('leaves a non-matching file untouched', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'README.md'), '# notes\n');
    fs.writeFileSync(path.join(dir, 'plot-notes.txt'), 'notes\n');

    const removed = pruneStaleVendoredHelpers(dir, []);

    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(path.join(dir, 'README.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'plot-notes.txt')), true);
  });

  it('leaves a directory named plot-x.sh untouched', () => {
    const dir = makeDir();
    fs.mkdirSync(path.join(dir, 'plot-x.sh'));

    const removed = pruneStaleVendoredHelpers(dir, []);

    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(path.join(dir, 'plot-x.sh')), true);
  });

  it('logs the removed name for each stray', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'plot-one.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(dir, 'plot-two.sh'), '#!/bin/sh\n');

    const removed = pruneStaleVendoredHelpers(dir, []);

    assert.deepEqual(removed.sort(), ['plot-one.sh', 'plot-two.sh']);
  });
});
