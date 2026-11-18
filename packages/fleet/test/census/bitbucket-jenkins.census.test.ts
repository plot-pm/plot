import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { censusGate, findStrace } from './strace-run.js';
import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { startFleetd } from './fleetd-driver.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { BITBUCKET_ROUTE } from './stub-host.js';

// A Bitbucket repository with `CI: jenkins` reads every listing in-process,
// the rich open read included, because fleetd holds a Jenkins client and
// overlays the CI colours itself. This file runs fleetd untraced against a
// `CI: jenkins` fixture and counts the requests the stub `bb` and the stub
// server answer. A Bitbucket open listing is the same HTTP request whether it
// is rich or plain, so the server's count cannot tell the two apart; the
// shell's `bb api` open reads, which stay at zero, are the proof that the rich
// read stayed in the process.

/** The stub `bb api` calls naming the open state, which only an open read sends. */
const bbOpenReads = (box: Sandbox): number =>
  existsSync(box.stubLog)
    ? readFileSync(box.stubLog, 'utf8').split('\n').filter((l) => /^bb api\b/.test(l) && /state=OPEN/.test(l)).length
    : 0;

// The census runs where strace exists (Linux CI); a macOS run skips it, as the other census files do.
const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

let entry: FleetdEntry | undefined;
let box: Sandbox | undefined;
const started = { log: [] as string[] };

beforeAll(async () => {
  if (gate.kind !== 'run') return;
  entry = await buildFleetdEntry();
  box = await buildSandbox({ host: 'bitbucket', desks: 0, openPrs: 5, ci: 'jenkins' });
  const fleetd = startFleetd(entry, box, { trace: false });
  try {
    for (let n = 0; n < 3; n += 1) await fleetd.pass();
  } finally {
    const end = await fleetd.stop();
    started.log = end.stderr.split('\n');
  }
}, 600_000);

afterAll(async () => {
  entry?.remove();
  await box?.remove();
});

describe.skipIf(gate.kind !== 'run')('fleetd on bitbucket with CI: jenkins', () => {
  it('starts no stub bb open read', () => {
    expect(box).toBeDefined();
    if (box === undefined) return;
    expect(bbOpenReads(box)).toBe(0);
  });

  it('reads the open pull requests in-process', () => {
    if (box === undefined) return;
    const openRequests = (box.api?.requests() ?? []).filter((r) => r.path.startsWith(`${BITBUCKET_ROUTE}/`) && r.path.includes('pullrequests'));
    expect(openRequests.length).toBeGreaterThan(0);
  });

  it('logs the in-process transport and the credential source at start', () => {
    const lines = started.log.filter((l) => l.includes('host reads:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/host reads: in-process \(.*Jenkins reads: in-process \(credentials from [^)]+\)/);
    expect(lines[0]).not.toContain('stays on the shell');
  });
});
