import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStreaming } from '../../src/server/fleet.js';

// The measurement this file exists for, taken on this repo 2026-08-19 after the
// join (#232) landed: 26 of 54 branches are terminal — merged or deferred — and
// a terminal fact cannot change. A merged branch stays merged. The board pulses
// every 5 s, so those 26 answers were re-bought from the host forever.
//
// THE BOARD IS WHERE THE MAP LIVES, and that is forced rather than chosen. The
// scan is spawned fresh every pulse, so nothing inside it can span two; the
// board is the only long-lived process in the system. The scan takes the map in
// through the ENVIRONMENT and reports the map the next pulse should hold on
// STDERR, which keeps stdout byte-identical to a run with no cache at all.
//
// What is asserted here is the TRANSPORT and the LIFETIME — that the map
// crosses the process boundary intact, that stderr notes never reach the stdout
// parser, and that nothing is written to disk. Whether an entry is still VALID
// is the scan's question, because git is where the answer is; those assertions
// live in `test/reconcile/fleet.test.mjs`.

/**
 * A fake scan that echoes the cache it was handed and emits the notes it is
 * given, so a test can watch a map make the round trip.
 *
 * A SCRIPT rather than a stub, because the seam under test is the real one: an
 * environment variable into a spawned process and its stderr back out. A stub
 * would test a function call and would not notice a chunk boundary landing
 * mid-line, which is the failure the line buffering exists to survive.
 */
function fakeScan(notes: string[], { exitCode = 0, splitWrites = false } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-termcache-'));
  // Echoed to stdout so the test can prove what the child RECEIVED, and the
  // notes to stderr the way the real scan reports them.
  //
  // The entries are TAB-separated and the tabs must survive into the child as
  // real tabs. `printf '%s'` does not interpret escapes in its ARGUMENT, so a
  // `\t` written into the script text would arrive as two characters and the
  // round trip would be testing a string the scan never emits. Each field is
  // passed as a separate argument and rejoined by the format instead.
  const note = (n: string) => {
    const fields = n.split('\t').map((f) => JSON.stringify(f)).join(' ');
    const fmt = n.split('\t').map(() => '%s').join('\\t');
    return { fields, fmt };
  };
  const noteLines = notes
    .map((n) => {
      const { fields, fmt } = note(n);
      if (!splitWrites) return `printf 'terminal: ${fmt}\\n' ${fields} >&2\n`;
      // Deliberately split mid-line, with no trailing newline on the first
      // half: the note must still arrive as ONE line.
      return `printf '%s' 'termina' >&2\nprintf 'l: ${fmt}\\n' ${fields} >&2\n`;
    })
    .join('');
  fs.writeFileSync(path.join(dir, 'scan.sh'),
    `#!/usr/bin/env bash\nprintf 'got:%s\\n' "$PLOT_TERMINAL_CACHE"\n`
    + `printf '%s\\n' 'noise on stderr that is not a note' >&2\n`
    + `${noteLines}exit ${exitCode}\n`);
  fs.chmodSync(path.join(dir, 'scan.sh'), 0o755);
  return path.join(dir, 'scan.sh');
}

/** Run a fake scan the way `refresh()` does, collecting both streams. */
async function pulse(script: string, cache: string) {
  const out: string[] = [];
  let learned = '';
  await runStreaming('bash', [script], os.tmpdir(), (l) => out.push(l), 10_000, {
    env: { PLOT_TERMINAL_CACHE: cache },
    onErrLine: (line) => {
      if (line.startsWith('terminal:')) learned += `${line.slice('terminal:'.length).trim()}\n`;
    },
  });
  return { out, learned };
}

const ENTRY = 'feature/b0\tMERGED\tplanoid\tmainoid';

describe('the terminal cache crosses the pulse boundary', () => {
  it('hands the map to the scan and takes back what it reports', async () => {
    // THE ROUND TRIP, which is the whole of the board's half. Pulse one starts
    // cold and learns; pulse two must RECEIVE what pulse one learned.
    const script = fakeScan([ENTRY]);
    const first = await pulse(script, '');
    expect(first.out).toEqual(['got:']);
    expect(first.learned).toBe(`${ENTRY}\n`);

    const second = await pulse(script, first.learned);
    expect(second.out).toEqual([`got:${ENTRY}`]);
  });

  it('keeps stderr notes out of the stdout parser', async () => {
    // THE PROPERTY THAT MAKES THE CACHE INVISIBLE. The board parses stdout as
    // JSON lines; a note that leaked into that stream would be dropped by the
    // parser's catch and cost nothing visible — until the day it parsed.
    const { out } = await pulse(fakeScan([ENTRY]), '');
    expect(out.some((l) => l.includes('terminal:'))).toBe(false);
    expect(out.some((l) => l.includes('noise on stderr'))).toBe(false);
  });

  it('reassembles a note split across two writes', async () => {
    // A chunk boundary falls wherever the OS put it. Handing every fragment
    // onward would deliver half an entry, and half an entry that still parsed
    // into four tab-separated fields would be a cached answer about a branch
    // whose name had been truncated.
    const { learned } = await pulse(fakeScan([ENTRY], { splitWrites: true }), '');
    expect(learned).toBe(`${ENTRY}\n`);
  });

  it('ignores stderr that is not a tagged note', async () => {
    // The scan writes its ordinary prose to stderr too. Only the tagged lines
    // are the cache's, and everything else must stay discarded.
    const { learned } = await pulse(fakeScan([]), '');
    expect(learned).toBe('');
  });

  it('writes nothing to disk', async () => {
    // THE LINE THE PLAN DRAWS, asserted rather than trusted. A cache that
    // survived a restart would be a second source of truth about a repo whose
    // only source of truth is git (Manifesto Principle 1). The scan is handed
    // the map in the environment precisely so there is no file to find.
    const script = fakeScan([ENTRY]);
    const dir = path.dirname(script);
    const before = fs.readdirSync(dir).sort();
    await pulse(script, ENTRY);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });

  it('reports what it learned even when the scan fails', async () => {
    // A scan that exits non-zero still reported notes for the branches it
    // reached, and `runStreaming` rejects. The board's own rule — adopt the map
    // only on success — is what makes that safe, and it can only apply that
    // rule if the rejection does not swallow the stream.
    const script = fakeScan([ENTRY], { exitCode: 1 });
    await expect(pulse(script, '')).rejects.toThrow();
  });
});
