import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FleetReading } from '@plot-pm/domain';
import { rmTree } from '../helpers.mjs';

// The route's DEFAULT brief-branch resolver: the fleet's `briefBranchFromPulse`
// over the board's pulse. The module boundaries are replaced so the test sees
// the arguments the route passes, which a passing typecheck does not prove.

const pulse = { main: 'main', plans: [] } as unknown as FleetReading;
const briefBranchFromPulse = vi.fn((_pulse: FleetReading | null, _slug: string): string | null => 'feature/the-chosen-slice');

vi.mock('../../src/server/fleet.js', () => ({ pulseFor: () => pulse }));
vi.mock('@plot-pm/fleet/shared/dispatch-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plot-pm/fleet/shared/dispatch-command')>()),
  briefBranchFromPulse: (p: FleetReading | null, s: string) => briefBranchFromPulse(p, s),
}));

const SLUG = 'a-plan-with-a-brief-branch';
const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop() as string);
});

describe('handleImplement without an injected resolver', () => {
  it('briefs the branch the fleet\'s briefBranchFromPulse names for the board\'s pulse and the slug', async () => {
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
    expect(briefBranchFromPulse).toHaveBeenCalledWith(pulse, SLUG);
    expect(fs.readFileSync(implementBranchRecordPath(repoRoot, SLUG), 'utf8')).toBe('feature/the-chosen-slice');
  });
});
