import { describe, expect, it } from 'vitest';

import { bundlePathsOf, deskDirtFilter } from '../src/rules/desk-dirt-filter.js';

describe('deskDirtFilter', () => {
  it('keeps real work and strips the status code', () => {
    expect(deskDirtFilter(' M src/a.ts\n?? new.ts', [])).toEqual(['src/a.ts', 'new.ts']);
  });

  it('answers nothing for a clean desk', () => {
    expect(deskDirtFilter('', [])).toEqual([]);
  });

  it('drops the desk records at any depth, editor leftovers and tool scratch', () => {
    const porcelain = [
      '?? .plot-worker.log',
      '?? sub/.plot-worker.exit',
      '?? a.ts.tmp1',
      ' M b.swp',
      '?? c.orig',
      '?? .playwright-mcp/x.png',
      '?? .plot/agents/a.json',
      '?? .plot/state',
      '?? pkg/.omc/state/s.json',
      '?? kept.ts',
    ].join('\n');
    expect(deskDirtFilter(porcelain, [])).toEqual(['kept.ts']);
  });

  it('drops only the untracked root PLOT-CORRECTION.md line', () => {
    const porcelain = ['?? PLOT-CORRECTION.md', 'A  PLOT-CORRECTION.md', '?? docs/PLOT-CORRECTION.md'].join('\n');
    expect(deskDirtFilter(porcelain, [])).toEqual(['PLOT-CORRECTION.md', 'docs/PLOT-CORRECTION.md']);
  });

  it('drops a line whose whole path is a bundle path, and keeps a rename onto one', () => {
    const bundle = 'skills/plot/scripts/board/board-server.mjs';
    const porcelain = [` M ${bundle}`, `R  old.mjs -> ${bundle}`, ' M skills/plot/scripts/board/README.md'].join('\n');
    expect(deskDirtFilter(porcelain, [bundle])).toEqual([`old.mjs -> ${bundle}`, 'skills/plot/scripts/board/README.md']);
  });

  it('reads a rename and a quoted path as their whole text', () => {
    expect(deskDirtFilter('R  a.ts -> b.ts.bak\n?? "with space.ts"', [])).toEqual(['"with space.ts"']);
  });

  it('drops an empty line and a line too short to carry a path', () => {
    expect(deskDirtFilter('\n??\n M x.ts\n', [])).toEqual(['x.ts']);
  });
});

describe('bundlePathsOf', () => {
  it('reads every single-line shipped declaration once', () => {
    const text = [
      "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
      "const shippedAsk = path.join(here, '../../skills/plot/scripts/board/plot-ask.mjs'); const shippedX = path.join(here, '../../a/x.mjs');",
      "const shippedAgain = path.join(here, '../../skills/plot/scripts/board/plot-ask.mjs');",
    ].join('\n');
    expect(bundlePathsOf(text)).toEqual([
      'skills/plot/scripts/board/board-server.mjs',
      'skills/plot/scripts/board/plot-ask.mjs',
      'a/x.mjs',
    ]);
  });

  it('skips a declaration that spans lines', () => {
    expect(bundlePathsOf("const shippedLong = path.join(\n  here,\n  '../../a/long.mjs',\n);")).toEqual([]);
  });

  it('keeps the whole declaration where no ../../ argument is named', () => {
    expect(bundlePathsOf("const shippedLocal = path.join(here, 'local.mjs');")).toEqual([
      "shippedLocal = path.join(here, 'local.mjs')",
    ]);
  });

  it('reads the last ../../ argument of a declaration', () => {
    expect(bundlePathsOf("const shippedTwo = path.join('../../a.mjs', '../../b.mjs');")).toEqual(['b.mjs']);
  });

  it('answers nothing for a build file with no declaration', () => {
    expect(bundlePathsOf('export {};')).toEqual([]);
  });
});
