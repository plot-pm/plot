---
'plot': minor
---

The monitors publish their findings to a channel, and subscribers connect to it
with a purpose.

A unix socket under `.plot/` speaking NDJSON, with every decision — which
purposes may be served, who receives a finding, when a subscription is over — in
`rules/channel.ts` and none of it in the transport. A purpose naming a condition
no monitor measures is refused immediately, naming what it cannot serve, rather
than left pending forever; a purpose dies with its subscriber; and a heartbeat
carrying when each monitor was last heard is what separates
silence-because-healthy from silence-because-gone.
