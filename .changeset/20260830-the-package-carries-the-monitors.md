---
'@plot-pm/board': patch
---

A board installed from npm dispatches workers that are actually monitored.

`plot-dispatch.sh` now starts two monitors beside every worker it creates, and
it resolves them as `$script_dir` siblings — the same way it reaches every other
helper. The package ships the dispatcher, so without the monitors beside it an
installed board would dispatch workers that are silently unmonitored.

**Silently is the operative word, and it is why this is listed by hand.** A
missing monitor does not produce `bash exited 127` the way a missing helper
does: `start_worker` passes an empty path, the wrapper reads it as *not
attached*, and the worker starts unwatched. That is deliberate — a detached
`sh -c` nobody is reading must not spew `command not found` — but it means the
failure has no symptom, which is exactly the class of thing the monitors exist
to end.

The vendor gate derives its list from the scripts the SERVER spawns, and the
server spawns neither monitor; the dispatcher does. So the gate cannot see this
one, and `build.mjs` carries a comment saying so beside the two entries.
