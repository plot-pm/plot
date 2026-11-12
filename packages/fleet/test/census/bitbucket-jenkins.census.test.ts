import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { censusGate, findStrace } from './strace-run.js';
import { buildFleetdEntry, type FleetdEntry } from './fleetd-entry-build.js';
import { startFleetd } from './fleetd-driver.js';
import { buildSandbox, type Sandbox } from './sandbox.js';
import { BITBUCKET_ROUTE } from './stub-host.js';

// A Bitbucket repository with `CI: jenkins` reads its plain states in-process
// and its rich open read through `plot-host.sh pr-list --state open --rich`,
// because only the shell overlays Jenkins colours on the checks. The census
// P10 row runs on a fixture with no `CI` key and so cannot see the split. This
// file runs fleetd untraced against a `CI: jenkins` fixture and counts the
// requests the stub server and the stub `bb` answer.

/** The stub `bb api` calls naming the open state, which only an open read sends. */
const bbOpenReads = (box: Sandbox): number =>
  existsSync(box.stubLog)
    ? readFileSync(box.stubLog, 'utf8').split('\n').filter((l) => /^bb api\b/.test(l) && /state=OPEN/.test(l)).length
    : 0;

/** The requests to the stub server's Bitbucket route that read the open state. */
const serverOpenReads = (box: Sandbox): number =>
  (box.api?.requests() ?? []).filter((r) => r.path.startsWith(`${BITBUCKET_ROUTE}/`) && /(^|&)state=OPEN(&|$)/.test(r.query)).length;

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
  it('reads the rich open pull requests through the shell, and sends the stub server no open read', () => {
    expect(box).toBeDefined();
    if (box === undefined) return;
    expect(bbOpenReads(box)).toBeGreaterThan(0);
    expect(serverOpenReads(box)).toBe(0);
  });

  it('reads the other states in-process', () => {
    if (box === undefined) return;
    const bitbucketRequests = (box.api?.requests() ?? []).filter((r) => r.path.startsWith(`${BITBUCKET_ROUTE}/`));
    expect(bitbucketRequests.length).toBeGreaterThan(0);
  });

  it('logs the transport, the Jenkins reason and the credential source at start', () => {
    expect(started.log.filter((l) => l.includes('host reads:'))).toEqual([
      'plot-fleetd: host reads: in-process (the git host is bitbucket; CI is jenkins, so the rich open read stays on the shell; token from environment)',
    ]);
  });
});
