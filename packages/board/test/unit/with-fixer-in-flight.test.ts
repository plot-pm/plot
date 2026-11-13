// `withFixerInFlight` reads a fixer record for the one kind of row the loose-end rule asks.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixerAttemptsPath } from '@plot-pm/domain/adapters/fixer-attempts/fixer-attempts-file';
import { withFixerInFlight } from '../../src/server/fleet.js';
import type { AgentRow } from '../../src/contract/schema.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-fixer-flight-'));
  made.push(dir);
  return dir;
};

const row = (over: Record<string, unknown>): AgentRow =>
  ({ branch: 'feature/x', plan: '', state: 'wip', pr: { number: 7, state: 'green', open: true }, ...over }) as unknown as AgentRow;

const record = (root: string, pr: number, text: string): void => {
  const file = fixerAttemptsPath(root, pr);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe('withFixerInFlight', () => {
  it('marks an open planless PR false where no record exists', async () => {
    const [out] = await withFixerInFlight([row({})], repo());
    expect(out!.fixerInFlight).toBe(false);
  });

  it('marks an open planless PR true where the record cannot be parsed, which holds', async () => {
    const root = repo();
    record(root, 7, 'not json');
    const [out] = await withFixerInFlight([row({})], root);
    expect(out!.fixerInFlight).toBe(true);
  });

  it.each([
    ['a row a plan names', { plan: 'p' }],
    ['a row with no PR', { pr: null }],
    ['a merged row', { state: 'merged' }],
    ['a closed PR', { pr: { number: 7, state: 'none', open: false } }],
  ])('leaves %s unread', async (_label, over) => {
    const [out] = await withFixerInFlight([row(over)], repo());
    expect(out!.fixerInFlight).toBeUndefined();
  });
});
