---
"plot": patch
---

Board test suite retries git calls when index.lock is held by the servers scan

CI failed on a commit that added only markdown, with git reporting Unable to
create /.git/index.lock File exists. The test fixtures start a real board
server against the repo they then mutate, and both sides contend for the lock.

The tests git helper now retries a bounded, lock-specific number of times on
a transient index.lock hold, but fails immediately on any other git error.
This is the same approach plot-fleet-scan.sh already takes in production —
a lock reads as "an agent is writing HERE, RIGHT NOW", a state to handle rather
than an error to propagate.

The retry is bounded (10 attempts, 25 ms each = ~250 ms patience) and keyed on
the lock message specifically. A blanket retry would paper over real git errors
and turn a deterministic failure into a slow flaky one.

Tested deliberately: a test holds index.lock from another process and asserts
the helper survives it. A non-lock error still fails on the first attempt. The
race is load-dependent — it failed in CI under four-agent load and passed 11/11
in isolation — so neither test relies on the race happening.

The same race also broke teardown. `after()` hooks await `server.stop()`, but
that resolves when the server process exits — not when the git children it
spawned mid-scan do. A grandchild is outside the scope of that SIGTERM, so it
can still write into the fixture while `rmSync` walks it, and `rmdir` then fails
with ENOTEMPTY. CI failed exactly this way on `outer/.git`. Awaiting the server
was the earlier attempt at this and did not hold, because it addressed the
process that was waited for rather than the ones that were not.

A matching `rmTree` helper retries only ENOTEMPTY/EBUSY/EPERM, and every
suite that starts a server against a git repo now uses it. `read-ref` also
carried its own non-retrying copy of the git helper; it now imports the shared
one, so there is again a single implementation.

Its tests inject the failure rather than race for it: a real writer could not be
made to lose reliably — measured, a child recreating the file every 1 ms still
let a plain `rmSync` succeed — so a test built that way would pass whether or
not the retry existed.

<!--
bumps:
  skills:
    plot: patch
-->
