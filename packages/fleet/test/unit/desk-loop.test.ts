import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerLine, run } from '../../src/server/entry/desk-loop.js';
import { readDeskLoop } from '../../src/shared/desk-loop.js';
import { removeTree } from '../rm-tree.mjs';

// A pid above every platform's pid limit: `kill -0` answers ESRCH for it.
const DEAD = '99999999';
const LIVE = String(process.pid);

let desk = '';
beforeEach(() => {
  desk = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-loop-'));
});
afterEach(() => {
  removeTree(desk);
});

const write = (name: string, text: string): void => fs.writeFileSync(path.join(desk, name), text);

describe('readDeskLoop', () => {
  it('reads a live .plot-worker.pid with no free-wait record as alive and held', () => {
    write('.plot-worker.pid', `${LIVE}\n`);
    expect(answerLine(readDeskLoop(desk, { kind: 'unnamed' }))).toBe(`alive\t${LIVE}\t.plot-worker.pid\theld`);
  });

  it('reads a free-wait record naming the live pid as free', () => {
    write('.plot-worker.pid', `${LIVE}\n`);
    write('.plot-worker.freewait', `${LIVE}\n`);
    expect(answerLine(readDeskLoop(desk, { kind: 'unnamed' }))).toBe(`alive\t${LIVE}\t.plot-worker.pid\tfree`);
  });

  it('reads a free-wait record naming another pid as held', () => {
    write('.plot-worker.pid', `${LIVE}\n`);
    write('.plot-worker.freewait', `${DEAD}\n`);
    expect(answerLine(readDeskLoop(desk, { kind: 'unnamed' }))).toBe(`alive\t${LIVE}\t.plot-worker.pid\theld`);
  });

  it('reads a dead pid with a stale free-wait record as none', () => {
    write('.plot-worker.pid', `${DEAD}\n`);
    write('.plot-worker.freewait', `${DEAD}\n`);
    expect(answerLine(readDeskLoop(desk, { kind: 'unnamed' }))).toBe('none');
  });

  it('reads the manifest wrapperPid when the pid file and the manifest pid are dead', () => {
    write('.plot-worker.pid', `${DEAD}\n`);
    const manifest = path.join(desk, 'm.json');
    fs.writeFileSync(manifest, JSON.stringify({ worktree: desk, pid: DEAD, wrapperPid: LIVE }));
    expect(answerLine(readDeskLoop(desk, { kind: 'named', path: manifest }))).toBe(`alive\t${LIVE}\tmanifest wrapperPid\theld`);
  });

  it('reads a desk with no pid record as none', () => {
    expect(answerLine(readDeskLoop(desk, { kind: 'unnamed' }))).toBe('none');
  });
});

describe('plot-desk-loop run', () => {
  const deps = {
    manifestFor: () => ({ kind: 'unnamed' }) as const,
    read: (worktree: string) =>
      worktree === '/alive'
        ? { loop: { kind: 'alive', pid: '7', source: '.plot-worker.pid' } as const, waitsFree: false }
        : { loop: { kind: 'none' } as const, waitsFree: false },
  };

  it('answers one line per desk, in stdin order, skipping blank lines', () => {
    let out = '';
    expect(run([], '/none\n\n/alive\n', deps, (s) => { out += s; })).toBe(0);
    expect(out).toBe('none\nalive\t7\t.plot-worker.pid\theld\n');
  });

  it('counts the live loops under --count', () => {
    let out = '';
    expect(run(['--count'], '/alive\n/none\n/alive\n', deps, (s) => { out += s; })).toBe(0);
    expect(out).toBe('2\n');
  });

  it('answers 0 under --count for no desks', () => {
    let out = '';
    expect(run(['--count'], '', deps, (s) => { out += s; })).toBe(0);
    expect(out).toBe('0\n');
  });

  it('exits 2 for an unknown argument and writes no answer', () => {
    let out = '';
    expect(run(['--all'], '/alive\n', deps, (s) => { out += s; })).toBe(2);
    expect(out).toBe('');
  });
});
