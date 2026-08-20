// The mock fleet: one row per kind, for looking at.
//
// Two properties carry this file. **It validates against the real schema** — a
// mock the contract would reject proves nothing about what the board renders.
// And **it covers every kind the contract knows**, checked against
// `RowKindSchema.options` rather than against a list written here, so a kind
// added later fails this test instead of quietly going unrendered.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { mockFleet, mockRequested, MOCK_ENV } from '../../src/server/mock-fleet.js';
import { FleetSchema, RowKindSchema } from '../../src/contract/schema.js';

describe('the mock is only ever asked for', () => {
  it('is off by default', () => {
    assert.equal(mockRequested({}), false);
  });

  it('is on for an exact 1, and off for a truthy guess', () => {
    // The same rule the write gate applies: an opt-in must be typed knowingly.
    // A mock reaching a real estate would be read as the estate behaving oddly.
    assert.equal(mockRequested({ [MOCK_ENV]: '1' }), true);
    for (const v of ['0', 'true', 'yes', 'on', '', 'TRUE']) {
      assert.equal(mockRequested({ [MOCK_ENV]: v }), false, `for ${JSON.stringify(v)}`);
    }
  });
});

describe('the mock is a real payload', () => {
  it('passes the contract the board serves', () => {
    // `mockFleet` parses internally; this asserts the parse is the real schema
    // rather than a looser one, by re-parsing the result.
    assert.doesNotThrow(() => FleetSchema.parse(mockFleet()));
  });

  it('covers every kind the contract knows', () => {
    const fleet = mockFleet();
    const rendered = new Set(fleet.rows.map((r) => r.kind));
    // A ticket is NOT a row — issues travel in their own list — so it is the one
    // kind checked against `issues` instead. That asymmetry is what the mock
    // exists to show; a test that hid it would defeat the purpose.
    assert.ok(fleet.issues.length > 0, 'the ticket kind is present as an issue');
    for (const kind of RowKindSchema.options) {
      if (kind === 'ticket') continue;
      assert.ok(rendered.has(kind), `no row for kind ${kind}`);
    }
  });

  it('puts each kind in the section its kind belongs to', () => {
    // The grammar `every-section-has-one-subject` settles: an agent is in
    // WORKING, a build is what a machine is doing, a plan nobody took is not
    // started. A mock that grouped otherwise would teach the wrong shape.
    const by = new Map(mockFleet().rows.map((r) => [r.kind, r.group]));
    assert.equal(by.get('agent'), 'working');
    assert.equal(by.get('build'), 'waiting-on-machine');
    assert.equal(by.get('plan'), 'not-started');
    assert.equal(by.get('pr'), 'waiting-on-you');
    assert.equal(by.get('release'), 'waiting-on-you');
  });

  it('lists an agent in the registry, with a session and a transcript reading', () => {
    // The registry is what makes an agent nameable at all; a mock without one
    // would render an agent row the board could not explain.
    const [agent] = mockFleet().agents;
    assert.ok(agent, 'one agent');
    assert.match(agent.session, /^[0-9a-f]{8}-/);
    assert.equal(typeof agent.contextTokens, 'number');
  });
});
