---
"plot": patch
---

`--status` tells a finished worker from a crashed one.

Found by running a real worker for the first time. Every automated test uses `--no-start`, so nothing had ever exercised the path that starts a process — and a worker that completed its job was reported as **`dead`**, which reads as a crash. A user would see a healthy fleet and assume failure.

`kill -0` can only separate running from not-running; whether a stopped worker succeeded or crashed is gone unless the exit code was recorded. The wrapper now records it, and `--status` reports four states instead of two: **running**, **finished**, **failed (exit N)**, and **ended (status unknown)** for workers started before this existed or killed outright. Unknown stays its own answer — guessing "finished" would be the same mistake in the other direction.

Two traps surfaced while fixing it, both now pinned by a test that starts an actual process:

- A `Worker command` ending in `exit 0` terminated the wrapper shell *before* the exit code could be written. The command now runs in a subshell, so its `exit` confines itself.
- `$?` inside a double-quoted `sh -c` string was substituted by the *outer* shell before `sh` ever saw it. The wrapper is single-quoted and the exit-file path travels as an environment variable, so no quoting level can mangle it.

Also: a pid of `0` read as running forever, because `kill -0 0` signals the caller's whole process group and succeeds.
