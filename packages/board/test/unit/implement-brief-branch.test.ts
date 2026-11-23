import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FleetReading } from '@plot-pm/domain';
import type { DispatchReadingFor } from '@plot-pm/domain/rules/auto-dispatch';
import { rmTree } from '../helpers.mjs';

// The route's DEFAULT brief-branch resolver: the fleet's `startReadingFromPulses`
// over the board's pulses. The module boundaries are replaced so the test sees
// the arguments the route passes, which a passing typecheck does not prove.

const pulse = { main: 'main', plans: [] } as unknown as FleetReading;
const last = { main: 'main', plans: [] } as unknown as FleetReading;
const startReadingFromPulses = vi.fn(
  (_live: FleetReading | null, _complete: boolean, _last: FleetReading | null, _slug: string, _branch?: string): DispatchReadingFor => ({
    kind: 'branch',
    branch: 'feature/the-chosen-slice',
  }),
);

vi.mock('../../src/server/fleet.js', () => ({
  pulseFor: () => pulse,
  pulseCompleteFor: () => true,
  lastCompletePulseFor: () => last,
}));
vi.mock('@plot-pm/fleet/shared/dispatch-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plot-pm/fleet/shared/dispatch-command')>()),
  startReadingFromPulses: (l: FleetReading | null, c: boolean, lc: FleetReading | null, s: string, b?: string) =>
    startReadingFromPulses(l, c, lc, s, b),
}));

const SLUG = 'a-plan-with-a-brief-branch';
const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop() as string);
});

describe('handleImplement without an injected resolver', () => {
  it('briefs the branch the fleet\'s startReadingFromPulses names for the board\'s pulses and the slug', async () => {
    const { handleImplement, IMPLEMENT_COMMAND_KEY, implementBranchRecordPath } = await import('../../src/server/implement.js');
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-brief-'));
    made.push(parent);
    const repoRoot = path.join(parent, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    const req = Readable.from([JSON.stringify({ slug: SLUG })]) as unknown as http.IncomingMessage;
    req.headers = {};
    req.method = 'POST';
    let status = 0;
    const res = {
      headersSent: false,
      writeHead(s: number) { status = s; return this; },
      end() { return this; },
    } as unknown as http.ServerResponse;
    await handleImplement(req, res, { repoRoot, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 }, {
      config: (_o, key, fallback) => (key === IMPLEMENT_COMMAND_KEY ? 'true' : fallback),
    });
    expect(status).toBe(202);
    expect(startReadingFromPulses).toHaveBeenCalledWith(pulse, true, last, SLUG, undefined);
    expect(fs.readFileSync(implementBranchRecordPath(repoRoot, SLUG), 'utf8')).toBe('feature/the-chosen-slice');
  });
});
