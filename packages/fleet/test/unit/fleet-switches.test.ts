// The four auto switches: one state file, seeded from `## Plot Config`, read by
// the passes that act on them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeTree } from '../rm-tree.mjs';
import {
  defaultFleetSettings,
  readFleetSettings,
  readSwitch,
  writeFleetSettings,
  fleetSettingsPath,
} from '../../src/shared/fleet-settings-store.js';

let root: string;
const opts = () => ({ repoRoot: root, scriptsDir: path.join(root, 'no-scripts') });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-switches-'));
});
afterEach(() => {
  removeTree(root);
});

describe('readSwitch', () => {
  it('reads a switch off when neither a file nor a config key names it', () => {
    expect(readSwitch(opts(), 'autoReview')).toBe(false);
  });

  it('reads the state file in preference to the config key', async () => {
    const base = await defaultFleetSettings(opts());
    writeFleetSettings(root, { ...base, autoVerify: true });
    expect(readSwitch(opts(), 'autoVerify')).toBe(true);
    expect(readSwitch(opts(), 'autoDesign')).toBe(false);
  });

  it('answers off from a file that does not parse', () => {
    fs.mkdirSync(path.dirname(fleetSettingsPath(root)), { recursive: true });
    fs.writeFileSync(fleetSettingsPath(root), '{ not json');
    expect(readSwitch(opts(), 'autoReview')).toBe(false);
  });
});

describe('writeFleetSettings', () => {
  it('round-trips the three switches beside auto-dispatch', async () => {
    const base = await defaultFleetSettings(opts());
    writeFleetSettings(root, { ...base, autoReview: true, autoDesign: true });
    const read = await readFleetSettings(opts());
    expect(read).toMatchObject({ autoDispatch: false, autoReview: true, autoVerify: false, autoDesign: true });
  });

  it('reads a file written before the switches existed as off', async () => {
    fs.mkdirSync(path.dirname(fleetSettingsPath(root)), { recursive: true });
    fs.writeFileSync(fleetSettingsPath(root), JSON.stringify({ autoDispatch: true, parallelAgents: 2, machineOverride: false }));
    const read = await readFleetSettings(opts());
    expect(read).toMatchObject({ autoDispatch: true, autoReview: false, autoVerify: false, autoDesign: false });
  });
});
