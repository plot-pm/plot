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
    // THREE KINDS ARE NOT SERVER ROWS, and naming all three is the correction
    // this test needed. `rowKind` returns `release`, `branch` or `pr`; `build`
    // and `agent` are created at their own sites. **`plan` and `wave` are
    // assembled by the CLIENT** from the branches grouped under them —
    // `groupByPlan` + `tupleFromPlan`, `groupBySlice` + `tupleFromSlice` — and
    // `ticket` arrives in the separate `issues` list.
    //
    // The mock carried four `kind: 'plan'` rows until 2026-08-20 and this loop
    // demanded them, which is how a kind no pulse emits stayed in a fixture that
    // exists for fidelity. The check above (`carries no kind the real classifier
    // can produce`) is the other half; between them the two say what a payload
    // may hold and what it may not.
    // `plan` is BOTH now — assembled by the client for a plan's own row, and
    // emitted by the server for an `idea/` branch's PR. So it is no longer an
    // exemption here: the mock carries one.
    const CLIENT_ASSEMBLED = new Set(['ticket', 'wave']);
    for (const kind of RowKindSchema.options) {
      if (CLIENT_ASSEMBLED.has(kind)) continue;
      assert.ok(rendered.has(kind), `no row for kind ${kind}`);
    }
  });

  it('carries no kind the real classifier cannot produce', () => {
    // `rowKind` returns `release`, `branch` or `pr` and NOTHING else — no real
    // pulse has ever carried a `kind: 'plan'` row, because a plan row is
    // assembled by the client from the branches under it.
    //
    // The mock carried four of them anyway, and it read correctly for as long as
    // a not-started row STOOD FOR its plan. The moment the wave row took that
    // job, those rows became the branches inside a wave's fold and rendered
    // `Kind: Plan` two levels deep. The fidelity a mock is worth is exactly the
    // fidelity it is checked for, so this checks it.
    // `plan` JOINED THEM on 2026-08-20: `rowKind` returns it for an `idea/`
    // branch's PR, which is a plan awaiting approval rather than code awaiting
    // review. It is the one plan row the server emits — every other one is
    // assembled by the client from the branches under it.
    const SERVER_KINDS = new Set(['release', 'branch', 'pr', 'build', 'agent', 'plan']);
    for (const r of mockFleet().rows) {
      assert.ok(SERVER_KINDS.has(r.kind), `${r.branch} carries kind ${r.kind}, which no pulse emits`);
    }
  });

  it('carries branches that group into several waves, one of them multi-branch', () => {
    // What the mock owes the wave kind, since it cannot own a row of it: the two
    // shapes a wave row has to render. Measured over the estate, 20 of 21
    // unfinished waves hold ONE branch and one holds five — so the mock needs
    // both a single-branch wave (the common case, no fold) and a multi-branch one
    // (the fold), or the fold goes unrendered wherever anyone looks.
    const notStarted = mockFleet().rows.filter((r) => r.group === 'not-started');
    const bySlice = new Map<string, number>();
    for (const r of notStarted) bySlice.set(r.wave, (bySlice.get(r.wave) ?? 0) + 1);
    assert.ok(bySlice.size >= 3, `expected 3+ waves, got ${bySlice.size}`);
    const counts = [...bySlice.values()];
    assert.ok(counts.includes(1), 'no single-branch wave — the common case');
    assert.ok(counts.some((c) => c > 1), 'no multi-branch wave — the fold case');
    // Every one of them carries the verdict the wave row shows as its status.
    // A `null` here would render an empty slot 5, which is the defect the row
    // exists to fix arriving from the other side.
    for (const r of notStarted) {
      assert.ok(r.verdict, `${r.branch} carries no verdict for its wave to show`);
    }
  });

  it('puts each kind in the section its kind belongs to', () => {
    // The grammar `every-section-has-one-subject` settles: an agent is in
    // WORKING, a build is what a machine is doing, a plan nobody took is not
    // started. A mock that grouped otherwise would teach the wrong shape.
    // KEYED ON KIND ONLY WHERE THE KIND DECIDES, which is the correction the
    // wave row forced. `agent`, `build`, `pr` and `release` each sit in exactly
    // one section by their nature — an agent works, a build is a machine's — so
    // a Map from kind to group answers for them.
    //
    // `branch` does not, and a Map silently hid it: NOT STARTED holds branches
    // and so does WAITING ON YOU, and `new Map(...)` keeps the LAST entry for a
    // repeated key. So the old assertion `by.get('plan') === 'not-started'` was
    // only ever true because the mock mislabelled its not-started rows as
    // `plan`; a real payload would have failed it. NOT STARTED's membership is a
    // fact about the GROUP, so it is asserted as one.
    const rows = mockFleet().rows;
    const by = new Map(rows.map((r) => [r.kind, r.group]));
    assert.equal(by.get('agent'), 'working');
    assert.equal(by.get('build'), 'waiting-on-machine');
    assert.equal(by.get('pr'), 'waiting-on-you');
    assert.equal(by.get('release'), 'waiting-on-you');
    // NOT STARTED holds branches nobody has taken — and only branches, since a
    // plan row and a wave row are both assembled from them by the client.
    const notStarted = rows.filter((r) => r.group === 'not-started');
    assert.ok(notStarted.length > 0, 'not-started holds rows');
    for (const r of notStarted) {
      assert.equal(r.kind, 'branch', `${r.branch} is in not-started as a ${r.kind}`);
    }
    // And the PLAN row the server emits is in WAITING ON YOU, not here: a plan
    // under review is waiting on a person, while NOT STARTED holds work nobody
    // has begun. Two different questions, and `every-section-has-one-subject`
    // settles which section asks which.
    const planRows = rows.filter((r) => r.kind === 'plan');
    assert.equal(planRows.length, 2, 'two server-emitted plan rows');
    for (const r of planRows) {
      assert.equal(r.group, 'waiting-on-you');
      assert.ok(r.branch.startsWith('idea/'), `${r.branch} is an idea branch`);
    }
    // ONE DRAFT AND ONE NOT, because the branch name is what decides the kind
    // and the draft flag is independent of it. A mock carrying only drafts would
    // let a `draft`-reading implementation pass.
    assert.deepEqual(planRows.map((r) => r.pr?.draft).sort(), [false, true]);
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
