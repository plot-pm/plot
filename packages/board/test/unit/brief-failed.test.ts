// A brief writer that recorded a non-zero exit says so, and names its log —
// instead of reading as still waiting or, worse, as "approved — nobody has
// taken it".
//
// THE DECISION STAYS IN THE PAYLOAD; THE ROW READS IT. `fleet.ts` computes
// `briefFailed` from the implement route's recorded exit; `row-identity.ts`
// decides the note from the fields alone (`briefNote`), so these are unit
// tests. One browser test in `agents-tab.browser.test.ts` proves the failed
// note renders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import { implementLogPath, implementStatePath } from '../../src/server/implement.js';
import {
  briefFailedNote, briefNote, briefWriterFailed, needsBrief,
} from '../../src/app/lib/agent-rows/row-identity.js';
import { type AgentRow, type FleetReading } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';

const QUIET = 30;
const BRANCH = 'bug/a-brief-the-fleet-writes-shows-as-asked';
const PLAN_FILE = '2026-10-04-a-brief-the-fleet-writes-shows-as-asked.md';
const PLAN_SLUG = 'a-brief-the-fleet-writes-shows-as-asked';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-failed-'));
});

afterEach(() => {
  rmTree(root);
});

const write = (file: string, content = ''): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** One approved plan, one eligible wave, one open branch — the reported shape. */
const pulse = (branch = BRANCH): FleetReading => ({
  plans: [{
    file: PLAN_FILE,
    phase: 'approved',
    slices: [{
      name: 'Writing it',
      verdict: 'eligible',
      branches: [{ branch, state: 'open', deferred: false, deferred_reason: '', claimed: '' }],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
} as unknown as FleetReading);

const rowFor = (repoRoot: string, branch = BRANCH): AgentRow =>
  rowsFromPulse(
    pulse(branch), new Map(), 'plot', QUIET,
    new Map(), '', null, Date.now(), null, null, null, null, null, repoRoot,
  ).find((r) => r.branch === branch)!;

describe('briefFailed on the row', () => {
  it('holds the implement log\'s path for a non-zero recorded exit after the ask', () => {
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;
    write(implementStatePath(root, PLAN_SLUG), '1');
    // The state write must postdate the ask for this to read as THIS failure.
    fs.utimesSync(implementStatePath(root, PLAN_SLUG), askedAt / 1000 + 1, askedAt / 1000 + 1);

    const row = rowFor(root);
    expect(row.briefFailed).toBe(path.relative(root, implementLogPath(root, PLAN_SLUG)));
    expect(briefWriterFailed(row)).toBe(true);
  });

  it('is null while the writer is still running', () => {
    write(implementLogPath(root, PLAN_SLUG));
    const row = rowFor(root);
    expect(row.briefFailed).toBeNull();
    expect(briefWriterFailed(row)).toBe(false);
  });

  it('is null once the writer succeeded', () => {
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;
    write(implementStatePath(root, PLAN_SLUG), '0');
    fs.utimesSync(implementStatePath(root, PLAN_SLUG), askedAt / 1000 + 1, askedAt / 1000 + 1);

    const row = rowFor(root);
    expect(row.briefFailed).toBeNull();
  });

  it('is null where no run ever happened', () => {
    const row = rowFor(root);
    expect(row.briefFailed).toBeNull();
    expect(row.briefAskedAt).toBeNull();
  });

  it('needsBrief still fires: the brief is missing whether the writer failed or not', () => {
    // `briefFailed` is an ADDITIONAL fact beside `needsBrief`'s own question
    // (can this row be started). A failed writer still leaves no brief behind,
    // so starting is still the thing this row needs.
    write(implementLogPath(root, PLAN_SLUG));
    const askedAt = fs.statSync(implementLogPath(root, PLAN_SLUG)).mtimeMs;
    write(implementStatePath(root, PLAN_SLUG), '1');
    fs.utimesSync(implementStatePath(root, PLAN_SLUG), askedAt / 1000 + 1, askedAt / 1000 + 1);

    const row = rowFor(root);
    expect(row.brief).toBe('missing');
  });
});

describe('row-identity gives the failed sentence', () => {
  it('names the log and says the writer failed', () => {
    const note = briefFailedNote('.worktrees/plot-implement-a-plan.log');
    expect(note).toContain('failed');
    expect(note).toContain('.worktrees/plot-implement-a-plan.log');
  });

  it('briefWriterFailed reads the field, not the filesystem', () => {
    expect(briefWriterFailed({ briefFailed: null })).toBe(false);
    expect(briefWriterFailed({ briefFailed: '.worktrees/plot-implement-a-plan.log' })).toBe(true);
  });

  it('briefWriterFailed reads a missing field as not failed — the client casts, never parses', () => {
    expect(briefWriterFailed({})).toBe(false);
    expect(briefWriterFailed({ briefFailed: undefined })).toBe(false);
  });
});

describe('briefNote chooses the note a row shows', () => {
  const NOW = 1_000_000_000_000;
  const LOG = '.worktrees/plot-implement-a-plan.log';

  it('shows the failed note when both briefFailed and briefAskedAt are set', () => {
    const note = briefNote({ briefFailed: LOG, briefAskedAt: NOW - 45_000 }, NOW);
    expect(note).toEqual({ kind: 'failed', label: 'brief failed', text: briefFailedNote(LOG) });
  });

  it('shows the asked note, aged against the given clock, when only briefAskedAt is set', () => {
    const note = briefNote({ briefFailed: null, briefAskedAt: NOW - 45_000 }, NOW);
    expect(note).toEqual({ kind: 'asked', label: 'brief asked', text: 'a brief was asked for 45s ago' });
  });

  it('is null when neither is set, or both are missing from an older payload', () => {
    expect(briefNote({ briefFailed: null, briefAskedAt: null }, NOW)).toBeNull();
    expect(briefNote({}, NOW)).toBeNull();
  });
});
