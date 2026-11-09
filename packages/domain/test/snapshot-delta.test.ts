import { describe, it, expect } from 'vitest';
import { deltaOf } from '../src/rules/snapshot-delta.js';
import { SNAPSHOT_PROTOCOL } from '../src/entities/subscription.js';
import { emptySnapshot } from '../src/entities/snapshot.js';
import { recordReading } from '../src/rules/snapshot-record.js';

describe('deltaOf', () => {
  const before = emptySnapshot();
  const config = { state: 'read' as const, readAt: 5, value: { a: 'b' } };
  const after = recordReading(before, 'config', config);

  it('carries the changed readings only, from the generation it applies to', () => {
    expect(deltaOf('e1', before, after.snapshot, after.changed)).toEqual({
      type: 'delta',
      protocol: SNAPSHOT_PROTOCOL,
      epoch: 'e1',
      generation: before.generation + 1,
      base: before.generation,
      readings: { config },
    });
  });

  it('sends nothing where no key changed', () => {
    expect(deltaOf('e1', before, before, [])).toBeUndefined();
  });

  it('sends nothing where the generation did not rise', () => {
    expect(deltaOf('e1', after.snapshot, before, ['config'])).toBeUndefined();
  });
});
