import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run, shadowIsOther } from '../../src/server/entry/fleetctl-start.js';
import { removeTree } from '../rm-tree.mjs';

/** Runs one verb and collects both streams. */
const ask = (argv: string[], uid = 501) => {
  let out = '';
  let err = '';
  const code = run(argv, (s) => (out += s), (s) => (err += s), uid);
  return { code, out, err };
};

describe('plot-fleetctl-start.mjs', () => {
  it('exits 2 for an unknown verb or a missing argument', () => {
    expect(ask(['nope']).code).toBe(2);
    expect(ask(['reload', 'com.plot-pm.fleetd']).code).toBe(2);
  });

  it('probe refuses an unresolved harness on stderr with exit 1', () => {
    const r = ask(['probe', 'claude', '', '', '/usr/bin/node', 'launchd', '/x/plot-fleetd.mjs']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/cannot resolve the agent harness 'claude'/);
    expect(r.out).toBe('');
  });

  it('restart previews on stdout for a dry run and is silent otherwise', () => {
    expect(ask(['restart', 'L', 'launchd', 'loaded', '42', 'abc', '1']).out).toMatch(/^would reload L \(launchd\)/);
    expect(ask(['restart', 'L', 'launchd', 'loaded', '42', 'abc', '0'])).toEqual({ code: 0, out: '', err: '' });
    expect(ask(['restart', 'L', 'launchd', '', '', 'abc', '0']).code).toBe(1);
  });

  it('reload prints the command words on one line', () => {
    expect(ask(['reload', 'L', 'launchd', 'plot-fleetd'], 501).out).toBe('launchctl kickstart -k gui/501/L\n');
  });

  it('restarted exits 0 on a new pid and 1 on the same pid', () => {
    expect(ask(['restarted', 'L', '1', '2', 'abc', '30', 'read']).code).toBe(0);
    expect(ask(['restarted', 'L', '1', '1', 'abc', '30', 'read']).code).toBe(1);
  });
});

describe('shadowIsOther', () => {
  it('is false for no file, true for another executable, and false for the same file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetctl-start-'));
    try {
      const harness = path.join(dir, 'harness');
      const other = path.join(dir, 'other');
      fs.writeFileSync(harness, '#!/bin/sh\n', { mode: 0o755 });
      fs.writeFileSync(other, '#!/bin/sh\n', { mode: 0o755 });
      expect(shadowIsOther(path.join(dir, 'absent'), harness)).toBe(false);
      expect(shadowIsOther(other, harness)).toBe(true);
      expect(shadowIsOther(harness, harness)).toBe(false);
      fs.chmodSync(other, 0o644);
      expect(shadowIsOther(other, harness)).toBe(false);
    } finally {
      removeTree(dir);
    }
  });

  describe('agents', () => {
    // dry-run desk pid state branch blocked dirty pr startedAt pidStartedAt current
    const desk = (over: Record<number, string> = {}) => {
      const f = ['0', 'd', '9', 'running', '', '', '0', '', 'iso', 'lstart', 'yes'];
      for (const [i, v] of Object.entries(over)) f[Number(i)] = v;
      return ask(['agents', ...f]);
    };
    const action = (r: { out: string }) => r.out.split('\t')[0];

    it('stops a free detached loop and prints action<TAB>line', () => {
      const r = desk();
      expect(r.code).toBe(0);
      expect(r.out).toBe('stop\t  d (pid 9)  stopping — free loop\n');
    });

    it('reads the PR JSON: OPEN keeps, MERGED frees a branch desk, CLOSED holds the slice', () => {
      expect(action(desk({ 4: 'f/x', 7: '{"state":"OPEN"}' }))).toBe('keep');
      expect(action(desk({ 4: 'f/x', 7: '{"state":"MERGED"}' }))).toBe('stop');
      expect(action(desk({ 4: 'f/x', 7: '{"state":"CLOSED"}' }))).toBe('keep');
    });

    it('keeps on an empty or unparseable PR answer, and says unreadable', () => {
      expect(desk({ 4: 'f/x', 7: '' }).out).toContain('PR unreadable');
      expect(desk({ 4: 'f/x', 7: 'not json' }).out).toContain('PR unreadable');
    });

    it('keeps on a dirt count that is not a number, and on a marker listing', () => {
      expect(desk({ 6: '' }).out).toContain('uncommitted files unreadable');
      expect(desk({ 5: '/w/PLOT-BLOCKED.md' }).out).toContain('PLOT-BLOCKED marker');
    });

    it('refuses a pid whose start differs, and keeps one with no recorded start', () => {
      expect(action(desk({ 10: 'no' }))).toBe('refuse');
      expect(action(desk({ 8: '', 9: '', 10: 'no' }))).toBe('keep');
    });

    it('exits 2 for a missing argument', () => {
      expect(ask(['agents', '0', 'd']).code).toBe(2);
    });
  });

  it('restart refuses --agents when unattended, and only then', () => {
    const args = ['restart', 'l', 'launchd', 'loaded', '1', 'abc', '0'];
    expect(ask([...args, '1', '1']).code).toBe(1);
    expect(ask([...args, '1', '0']).code).toBe(0);
    expect(ask([...args, '0', '1']).code).toBe(0);
    expect(ask(args).code).toBe(0);
  });
});
