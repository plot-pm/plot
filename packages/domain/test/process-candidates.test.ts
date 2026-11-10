import { describe, expect, it } from 'vitest';
import { processCandidate, processCandidates } from '../src/rules/process-candidates.js';

const SCAN = 'plot-fleet-scan.sh';
const row = (args: string, pid = 101, ppid = 1, uid = 501): string => `  ${pid}     ${ppid}   ${uid} ${args}`;
const rowS = (args: string, pid?: number, ppid?: number, uid?: number): string | undefined => processCandidate(row(args, pid, ppid, uid), SCAN);

describe('processCandidate', () => {
  it('names the board, the supervisor, the old supervisor and both scans', () => {
    expect(rowS('/usr/local/bin/node /w/skills/plot/scripts/board/plot-fleetd.mjs')).toBe('C\t101\t1\t501\tsupervisor\t-\t/w/skills/plot/scripts/board/plot-fleetd.mjs');
    expect(rowS('node --watch /w/board/board-server.mjs --port 1')).toBe('C\t101\t1\t501\tboard\t-\t/w/board/board-server.mjs');
    expect(rowS('node /w/board/plot-registryd.mjs')).toBe('C\t101\t1\t501\tsupervisor\t-\t/w/board/plot-registryd.mjs');
    expect(rowS('node /w/board/plot-scan-walk.mjs')).toBe('C\t101\t1\t501\tscan\t-\t/w/board/plot-scan-walk.mjs');
    expect(rowS('/bin/bash -x /w/plot-fleet-scan.sh extra')).toBe('C\t101\t1\t501\tscan\t-\t/w/plot-fleet-scan.sh');
    expect(rowS('bash plot-fleet-scan.sh')).toBe('C\t101\t1\t501\tscan\t-\tplot-fleet-scan.sh');
  });

  it('reads a systemd --user process as the subreaper', () => {
    expect(rowS('/usr/lib/systemd/systemd --user', 883, 1, 1001)).toBe('S\t883');
  });

  it('refuses text that is code: node -e, -p, --eval, --print and a shell -c', () => {
    for (const args of ["node -e require('/x/board/plot-fleetd.mjs')", 'node -pX /x/board/plot-fleetd.mjs', 'node --eval=1 /x/board/plot-fleetd.mjs', 'node --print /x/board/plot-fleetd.mjs', 'bash -lc /x/plot-fleet-scan.sh']) {
      expect(rowS(args)).toBeUndefined();
    }
  });

  it('keeps an argv0 that holds a space and prints - for every other', () => {
    expect(rowS('/Applications/My App/node /x/board/plot-fleetd.mjs')).toBe('C\t101\t1\t501\tsupervisor\t/Applications/My App/node\t/x/board/plot-fleetd.mjs');
  });

  it('takes the earlier artefact and needs a space or the end after it', () => {
    expect(rowS('node /x/board/plot-registryd.mjs /y/board/plot-fleetd.mjs')).toBe('C\t101\t1\t501\tsupervisor\t-\t/x/board/plot-registryd.mjs');
    expect(rowS('node /x/board/plot-fleetd.mjsX')).toBeUndefined();
    expect(rowS('/bin/sh /x/notplot-fleet-scan.sh')).toBeUndefined();
  });

  it('reads no scan when the scan script name is empty', () => {
    expect(processCandidate(row('bash /x/plot-fleet-scan.sh'), '')).toBeUndefined();
  });

  it('takes the board when its path comes before a supervisor path', () => {
    expect(rowS('node /x/board/board-server.mjs /y/board/plot-fleetd.mjs')).toBe('C\t101\t1\t501\tboard\t-\t/x/board/board-server.mjs');
    expect(rowS('node /y/board/plot-fleetd.mjs /x/board/board-server.mjs')).toBe('C\t101\t1\t501\tsupervisor\t-\t/y/board/plot-fleetd.mjs');
  });

  it('finds no path in arguments that are only spaces or hold no slash', () => {
    expect(rowS('node  ')).toBeUndefined();
    expect(rowS('node foo')).toBeUndefined();
    expect(rowS('node foo ')).toBeUndefined();
  });

  it('skips a row with no pid, ppid and uid, or no node, bash or sh', () => {
    expect(processCandidate('garbage line', SCAN)).toBeUndefined();
    expect(rowS('nodejs /x/board/board-server.mjs')).toBeUndefined();
    expect(rowS('/opt/xnode /x/board/board-server.mjs')).toBeUndefined();
  });
});

describe('processCandidates', () => {
  it('prints one newline-terminated line per classified row, in order', () => {
    const snapshot = [row('node /a/board/board-server.mjs', 7), 'noise', row('systemd --user', 8), ''].join('\n');
    expect(processCandidates(snapshot, SCAN)).toBe('C\t7\t1\t501\tboard\t-\t/a/board/board-server.mjs\nS\t8\n');
    expect(processCandidates('', SCAN)).toBe('');
  });
});
