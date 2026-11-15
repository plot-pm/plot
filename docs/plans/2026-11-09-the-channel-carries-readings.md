# The channel carries the snapshot

> The channel gains a versioned snapshot contract: a full snapshot on join, deltas after it, a generation number that lets a reader detect a missed delta and resynchronise, and a protocol version. A reader and a fleetd from different commits detect a mismatch, say so, and the reader falls back to its own reads.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** the-board-reads-the-channel
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3278 merged
- **Delivered:** 2026-11-09
- **Released:** 2026-11-11, v2.32.0

## Changelog

- fleetd sends its snapshot of the repository over the channel to a reader that asks for it, and then only what changed. A board and a fleetd from different releases notice the difference and the board keeps reading for itself, with one line in its log that names both versions.

Board impact: the board's channel hub learns to recognise a version mismatch and reports it on `/api/fleet`; it does not yet render from the snapshot. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

The channel carries findings today, not readings. `WelcomeSchema` sends `current: z.array(FindingSchema)` (`packages/domain/src/entities/channel-message.ts:15-21`), and the board ignores every event body: "the page refetches `/api/board` and renders that answer, so the event body is for a log or a test and the page ignores it" (`packages/board/src/server/channel-events.ts:9-13`). So every reader that wants an answer reads the world for itself. A board with one visible tab and fleetd running (census S3) starts 1212 `execve` per minute on the sprint head (`ee3541cff`; GitHub, 0 desks, 5 open PRs).

The story settles that the channel carries answers and each reader derives its verdicts (Decisions, 2026-11-05), and that the board reads the channel, not the persisted bridge `last-pulse.json` (panel, *Disagreements and Picks*): the bridge holds verdicts, and the board must derive its own.

The risk is high. The board does not reload its bundle when `main` moves, so a board and a fleetd from different commits share one socket (`CHANNEL_SOCKET = '.plot/fleet.sock'`, `registryd-main.ts:2468`, bound at `:2489`). A reader that misreads a newer or older message renders a wrong row with no error.

## Design

This plan depends on `the-snapshot-entity`: it sends `RepoSnapshot` and its `generation`. `board-reads-the-channel` depends on this plan and on `fleetd-heartbeat-not-data-age`. This plan moves no census row.

### Approach

**The contract is a domain entity; the transport stays.** The channel stays NDJSON over a Unix socket (`packages/domain/src/adapters/channel/channel-socket.ts`), with its 10 s heartbeat (`HEARTBEAT_MS`, `:34`). Three things are new, all in `@plot-pm/domain`.

**Slice 1: the contract and the reader rule.**

- `entities/subscription.ts` gains a purpose `{ kind: 'snapshot', protocol: number }`. `rules/channel.ts`'s `admit` serves it when `protocol` equals `SNAPSHOT_PROTOCOL` and refuses it otherwise, with a `refused` message whose reason names both versions.
- `entities/channel-message.ts` gains two message kinds. `snapshot` carries `protocol`, `epoch` (fleetd's start time and pid, unique per fleetd process), `generation` and the whole `RepoSnapshot`. `delta` carries `protocol`, `epoch`, `generation`, `base` (the generation it applies to) and the changed readings only.
- `rules/snapshot-sync.ts` holds the reader's rule, `applySnapshotMessage(held, message)`, an arrow function over values. It answers one of four outcomes: `adopt` (a full snapshot), `apply` (a delta whose `base` equals the held generation and whose `epoch` matches), `resync` (a gap in generations, or a new `epoch` after a fleetd restart), or `mismatch` (a `protocol` it does not speak, or a `refused` answer to the snapshot purpose).

**Why this negotiates versions with no new handshake.** `decode` (`channel-message.ts`) parses through a discriminated union and skips a line it cannot parse. An old board that subscribes with `everything` never asks for a snapshot and never receives one, so its behaviour does not change. A new reader that asks an old fleetd for the `snapshot` purpose gets `refused` from today's `admit`, because the purpose shape is unknown there (`rules/channel.ts:58`). A reader and a fleetd that both know the purpose but differ in `protocol` get `refused` from the new check. In each case the reader sees `mismatch` and falls back.

**Slice 2: fleetd publishes; the board detects.**

- fleetd's channel (`startFleetChannel`, `registryd-main.ts:2483`) serves the `snapshot` purpose from the snapshot that `the-snapshot-entity` fills. On join it sends one `snapshot` message. When `recordReading` reports changed keys, it sends one `delta` with those readings to every `snapshot` subscriber. A resync request is a new subscription: the reader closes and subscribes again, and receives a full snapshot.
- The domain adapter `adapters/channel/channel-client.ts` gains `subscribeSnapshot(address, onState)`, which holds the reader's copy through `applySnapshotMessage` and resubscribes on `resync`.
- The board's hub (`channel-events.ts`) subscribes for the snapshot alongside its `everything` subscription and keeps the held copy and its state (`current`, `resyncing`, `mismatch`, `absent`). `/api/fleet` reports that state and, on `mismatch`, both protocol versions. On `mismatch` the hub logs one line and the board reads for itself, as it does today. It renders nothing from the snapshot yet.

### Open Questions

- [ ] A delta per changed key on the 5 s tick may send most of the snapshot on every beat while the tick re-reads everything. Slice 2 measures the delta size on the census fixture and reports it; a person decides whether to coalesce deltas before Phase 8 removes the tick.
- [ ] The story asks for "a generation number so a reader detects a missed delta". A Unix stream socket does not drop a line inside one connection, so a gap means a reconnect or a new fleetd. This plan keys the resync on `epoch` and `base`; a person confirms that no other gap source exists.
- [x] `SNAPSHOT_PROTOCOL` starts at 1. A change to `RepoSnapshotSchema` that an older reader cannot parse must raise it. Slice 1 adds a test that fails when the schema's shape changes and the constant does not (a recorded fixture per protocol under `packages/domain/test/fixtures/`); The estate has the pattern already: `SPAWN_CONTRACT` and `SPAWN_CONTRACT_SHAPE` in `packages/domain/src/rules/spawn-contract.ts` hold a constant that a shape change must raise. Slice 1 follows it; a person confirms that the fixture test is the gate. **Decided 2026-11-08, jwloka: the fixture test (`snapshot-protocol.test.ts`, #3283) is the gate.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| A matching reader is admitted | `admit` with `{ kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL }` returns a subscription | Contract |
| A different protocol is refused by name | `admit` with `protocol: SNAPSHOT_PROTOCOL + 1` returns `refused`, and the reason names both versions | Contract |
| A reader detects a version mismatch | `applySnapshotMessage` answers `mismatch` for a `refused` answer and for a message whose `protocol` differs | Contract |
| A reader detects a missed delta | a delta with `base` one below the held generation answers `resync`; a delta with a new `epoch` answers `resync` | Contract |
| A delta applies in order | snapshot at generation 4, then delta base 4 → 5, then delta base 5 → 6, answers `apply` twice and holds generation 6 | Contract |
| Protocol 1 messages stay readable | the recorded protocol-1 fixtures decode; a schema change with no protocol bump fails the fixture test | Contract |
| A new reader against an old fleetd falls back | socket test: a channel built from the merge base's `admit` refuses the snapshot purpose; the hub's state reads `mismatch` and the board's scan still runs | Fleetd publishes |
| An old reader against a new fleetd is unchanged | socket test: an `everything` subscriber receives `welcome`, findings and heartbeats, and no `snapshot` or `delta` line | Fleetd publishes |
| A late joiner gets the whole snapshot | socket test: a subscriber that joins after three deltas receives one `snapshot` at the current generation | Fleetd publishes |
| A fleetd restart resynchronises | socket test: fleetd stops and starts; the reader answers `resync`, resubscribes and holds the new `epoch` | Fleetd publishes |
| Publishing adds no process | census S3 and S4 stay within the gate's tolerance against the merge base | Fleetd publishes |

## Slices

### Contract

- `feature/the-channel-carries-readings-contract` — the `snapshot` purpose and `SNAPSHOT_PROTOCOL` in `entities/subscription.ts` and `rules/channel.ts`; the `snapshot` and `delta` messages in `entities/channel-message.ts`; `applySnapshotMessage` in `rules/snapshot-sync.ts`; recorded protocol-1 fixtures <!-- builds: SNAPSHOT_PROTOCOL, a versioned snapshot-and-delta channel contract --> → #3283

### Fleetd publishes

- `feature/the-channel-carries-readings-publish` — fleetd serves the snapshot purpose from its snapshot; `subscribeSnapshot` in `adapters/channel/channel-client.ts`; the board hub holds the copy and reports `current`, `resyncing`, `mismatch` or `absent` on `/api/fleet`; socket tests for both version directions; a changeset for `@plot-pm/board` <!-- builds: subscribeSnapshot, a channel reader that resynchronises on a gap and reports a version mismatch --> → #3288

## Notes

- Phase 3 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `the-snapshot-entity`.
- Line numbers checked against `origin/sprint/nothing-runs` at `8437242ef` on 2026-11-08. The story cites `channel-message.ts:15-18` for `WelcomeSchema.current`; the schema spans `:15-21` and `current` is at `:18`. It cites `channel-events.ts:39` for `EventHub.clients()`; the interface member is at `:44` and the implementation at `:174`. It cites the channel heartbeat at `channel-socket.ts:33`; `HEARTBEAT_MS = 10_000` is at `:34`.
- The board's hub subscribes once at server start, whether or not a page is attached (`channel-events.ts`, `connect()`). A socket subscription is no process, so this plan keeps that and adds the second subscription the same way.
- Definition of Done: docs/definition-of-done.md.
