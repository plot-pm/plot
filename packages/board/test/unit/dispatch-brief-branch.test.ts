import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { FleetReading } from '@plot-pm/domain';
import { rmTree } from '../helpers.mjs';

// The dispatch route's DEFAULT brief-branch resolver: the fleet's
// `briefBranchFromPulse` over the board's pulse, with `deps.briefBranch` unset.
// The implement run is a command that writes `PLOT_BRIEF_BRANCH` to a file and
// exits 1, so no `plot-dispatch.sh` starts and the file is the branch the run
// received.

const pulse = { main: 'main', plans: [] } as unknown as FleetReading;
const briefBranchFromPulse = vi.fn((_pulse: FleetReading | null, _slug: string): string | null => 'feature/the-chosen-slice');

vi.mock('../../src/server/fleet.js', () => ({ pulseFor: () => pulse }));
vi.mock('@plot-pm/fleet/shared/dispatch-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plot-pm/fleet/shared/dispatch-command')>()),
  briefBranchFromPulse: (p: FleetReading | null, s: string) => briefBranchFromPulse(p, s),
}));

const SLUG = 'a-dispatch-briefs-the-pulses-branch';
const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop() as string);
});

const until = async (read: () => string | null): Promise<string> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const seen = read();
    if (seen !== null) return seen;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the implement run never wrote the branch it received');
};

describe('handleDispatch without an injected resolver', () => {
  it('hands the run the branch briefBranchFromPulse names for the board\'s pulse and the slug', async () => {
    const { handleDispatch } = await import('../../src/server/dispatch.js');
    const { IMPLEMENT_COMMAND_KEY } = await import('@plot-pm/fleet/shared/implement-run');
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-brief-'));
    made.push(parent);
    const repoRoot = path.join(parent, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    const received = path.join(parent, 'received');
    const req = Readable.from([JSON.stringify({ slug: SLUG })]) as unknown as http.IncomingMessage;
    req.headers = {};
    req.method = 'POST';
    let status = 0;
    const res = {
      headersSent: false,
      writeHead(s: number) { status = s; return this; },
      end() { return this; },
    } as unknown as http.ServerResponse;
    await handleDispatch(req, res, { repoRoot, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 }, {
      config: (_o, key, fallback) =>
        key === IMPLEMENT_COMMAND_KEY ? `printf %s "$PLOT_BRIEF_BRANCH" > '${received}'; false` : fallback,
    });
    expect(status).toBe(202);
    expect(briefBranchFromPulse).toHaveBeenCalledWith(pulse, SLUG);
    const branch = await until(() => (fs.existsSync(received) ? fs.readFileSync(received, 'utf8') : null));
    expect(branch).toBe('feature/the-chosen-slice');
  });
});
