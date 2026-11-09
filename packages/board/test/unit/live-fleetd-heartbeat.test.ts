import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveFleetdHeartbeat, rmTree } from '../helpers.mjs';

// The heartbeat timer outlives the test that started it. A beat after the
// test removed its repository must write nothing, or owned-run.sh finds a
// `.plot/state/fleetd.json` the test no longer owns.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('liveFleetdHeartbeat', () => {
  it('keeps the heartbeat fresh while the repository exists', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-heartbeat-'));
    try {
      liveFleetdHeartbeat(repo, 20);
      const file = path.join(repo, '.plot/state/fleetd.json');
      const first = JSON.parse(fs.readFileSync(file, 'utf8')).beatAt;
      await sleep(80);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).beatAt).toBeGreaterThan(first);
    } finally {
      rmTree(repo);
    }
  });

  it('recreates nothing after the repository is removed', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-heartbeat-'));
    liveFleetdHeartbeat(repo, 20);
    rmTree(repo);
    await sleep(80);
    expect(fs.existsSync(repo)).toBe(false);
  });
});
