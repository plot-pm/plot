import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { decode, DeltaMessageSchema, SnapshotMessageSchema } from '../src/entities/channel-message.js';
import { SNAPSHOT_PROTOCOL } from '../src/entities/subscription.js';
import { applySnapshotMessage } from '../src/rules/snapshot-sync.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'snapshot-protocol');
const messages = (protocol: number): string[] =>
  readFileSync(path.join(dir, `protocol-${protocol}.ndjson`), 'utf8').split('\n').filter((l) => l !== '');
const recordedShape = (protocol: number): unknown =>
  JSON.parse(readFileSync(path.join(dir, `protocol-${protocol}.shape.json`), 'utf8'));

describe('the snapshot protocol fixtures', () => {
  it('hold a recording for every protocol up to the current one', () => {
    const files = readdirSync(dir);
    for (let protocol = 1; protocol <= SNAPSHOT_PROTOCOL; protocol += 1) {
      expect(files, `record protocol ${protocol}: protocol-${protocol}.ndjson and .shape.json`).toContain(`protocol-${protocol}.ndjson`);
      expect(files).toContain(`protocol-${protocol}.shape.json`);
    }
  });

  it('decode for the current protocol', () => {
    const lines = messages(SNAPSHOT_PROTOCOL);
    expect(lines.map((line) => decode(line)?.type)).toEqual(['snapshot', 'delta', 'delta']);
    const [snapshot, first, second] = lines.map((line) => decode(line));
    if (snapshot?.type !== 'snapshot' || first?.type !== 'delta' || second?.type !== 'delta') throw new Error('bad fixture');
    const a = applySnapshotMessage(undefined, snapshot);
    if (a.outcome !== 'adopt') throw new Error('expected adopt');
    const b = applySnapshotMessage(a.held, first);
    if (b.outcome !== 'apply') throw new Error('expected apply');
    expect(applySnapshotMessage(b.held, second).outcome).toBe('apply');
  });

  it('record the protocol they belong to', () => {
    for (const line of messages(SNAPSHOT_PROTOCOL)) {
      expect(JSON.parse(line).protocol).toBe(SNAPSHOT_PROTOCOL);
    }
  });

  it('match the current message schema, or SNAPSHOT_PROTOCOL was not raised with a schema change', () => {
    const actual = JSON.parse(JSON.stringify(z.toJSONSchema(z.union([SnapshotMessageSchema, DeltaMessageSchema]), { io: 'input', unrepresentable: 'any' })));
    expect(
      actual,
      `the snapshot and delta message schemas no longer matches protocol-${SNAPSHOT_PROTOCOL}.shape.json: raise SNAPSHOT_PROTOCOL by one and record protocol-${SNAPSHOT_PROTOCOL + 1}.ndjson and .shape.json, or revert the schema change`,
    ).toEqual(recordedShape(SNAPSHOT_PROTOCOL));
  });
});
