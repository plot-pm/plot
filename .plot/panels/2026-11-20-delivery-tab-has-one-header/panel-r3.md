# Panel round 3 — delivery-tab-has-one-header

Round 3, 2026-11-20, on amendment b9795bcfa. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects. The operator approves on no reject (2026-11-20); the points below are the builder's to apply before or during the first slice.

Round 2: estate 8 of 8 resolved except the agents half of finding 1; testability 7 of 7; user 5 of 5.

## Builder notes, most important first

1. **The header still follows Mine through its agents** (all three lenses). `mappingInput` passes `agents: ownAgents`, narrowed by `agentsForReader` (`AgentList.tsx:644,1174-1179`); that list drives `live` in `placeDelivery` (`delivery-placement.ts:440`), so being built vs queued (`:350`), the agent-died and merge-conflict You cases (`:332,338`) and the Fleet circles change with Mine. Call `deliveryMapping` with `agents: fleet.agents` and `mode: 'all'`, and put an agent `agentsForReader` drops into the test fixture.
2. **Reuse `youHeader`** (`you-header.ts:109`, `youHeaderOf` at `AgentList.tsx:1202`) for the You group's counts; decide whether the red number counts a release approval (both `youHeader` and `todoList` add it today). `todoListOf` loses its only caller (`AgentList.tsx:1541`).
3. **Tests**: add `release-approve.browser.test.ts:76` (the reason span) and `delivery-tab-screenshots.browser.test.ts:109` to slice 2; `readRegistration` answers `null` before the read and on failure (`passkey-client.ts:19-25`); name the file of the `lastRelease` server test.
4. **Smaller**: the passkey re-read after a click (`ReleaseApprove.tsx:36`) moves up with the read on load; Fleet clear form reads "fleetCard counts no agent in any group"; two `ReleaseApprove.tsx` citations are off by one (`:48`, `:52`).
