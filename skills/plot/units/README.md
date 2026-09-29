# Keeping `plot-registryd` alive

`plot-registryd` supervises the agents a repository registered. Something has to supervise it, and that something is the operating system: `launchd` on macOS, `systemd` on Linux.

This directory holds one unit file for each, plus the install steps. Both are templates — replace the placeholders and install. The plist carries five (`__LABEL__`, `__REPO_ROOT__`, `__NODE__`, `__HARNESS_DIR__`, `__REGISTRYD__`); the systemd unit carries four, because a systemd unit has no label field. `__HARNESS_DIR__` is the directory that holds the agent harness (`claude`, or the name in `PLOT_HARNESS`). It goes first on the unit's `PATH`, so a worker runs the same binary as the operator's shell, and every other binary in that directory also comes first.

**`/plot-fleet --start` automates every step below**, and adds five refusals this page cannot enforce: a missing artifact, a `node` that is not the pinned major, a harness that `command -v` cannot resolve, no init system, and a label already loaded. Follow the steps by hand when you want to see what it does. A second checkout needs no hand steps: `PLOT_FLEET_LABEL` gives it its own launchd label or its own systemd unit, as described below.

## Why the OS and not Plot

*"Is a process that should be running actually running?"* is a machine-side question. Answering it with another Plot component would need a supervisor for that component too. `launchd` and `systemd` terminate the regress: they are already running, they already restart processes, and they need no help from Plot to do it.

```
launchd/systemd  ── restarts ──►  plot-registryd
plot-registryd   ── spawns   ──►  agents        ── run ──►  workers
```

Plot's own `Machine` entity is **not** this supervisor. It answers *is there room?* through `hasRoomToDispatch` and initiates nothing. The daemon asks the machine before spawning; the machine never tells the daemon anything.

## What restarts are for, and what they are not for

The daemon holds nothing between ticks. Every tick re-reads the registry directory and the desks its manifests name, and the previous tick's decision is never consulted. So a `kill -9` costs one tick's readings and no state — measured on 2026-09-04, a daemon killed two seconds into a 3.4 s tick was followed by a whole tick reaching the identical decision, with no state file written.

That is what makes an OS supervisor sufficient. There is no journal to replay, no lock to break, and no half-applied write to reconcile. Restarting the process **is** the recovery.

**A tick that cannot complete does not need a restart.** A git that will not fork, a registry directory removed mid-pass, a host adapter that rejects — each is reported on stderr and the loop takes its next tick a minute later, which re-reads everything from disk. The OS supervisor's restart is for a process that is *gone*, which is why both units restart unconditionally.

## Install — macOS (`launchd`)

Run these from the repository you want supervised.

```bash
# 1. Where things are. Run `nvm use` first if you use nvm — the daemon needs Node 24.
REPO_ROOT="$(git rev-parse --show-toplevel)"
NODE="$(command -v node)"
HARNESS_DIR="$(dirname "$(command -v "${PLOT_HARNESS:-claude}")")"   # check it printed a directory
REGISTRYD="$REPO_ROOT/skills/plot/scripts/board/plot-registryd.mjs"
LABEL="com.plot-pm.registryd"   # launchd keys the job by this string

# 2. The log directory the unit writes to.
mkdir -p "$REPO_ROOT/.plot/logs"

# 3. Fill the template into your LaunchAgents directory.
mkdir -p ~/Library/LaunchAgents
sed -e "s|__LABEL__|$LABEL|g" \
    -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__HARNESS_DIR__|$HARNESS_DIR|g" \
    -e "s|__REGISTRYD__|$REGISTRYD|g" \
    "$REPO_ROOT/skills/plot/units/com.plot-pm.registryd.plist" \
    > ~/Library/LaunchAgents/$LABEL.plist

# 4. Load it. It starts immediately and on every login.
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/$LABEL.plist
```

Check it:

```bash
launchctl print "gui/$(id -u)/com.plot-pm.registryd" | head -20
tail -f .plot/logs/registryd.log     # the tick lines
tail -f .plot/logs/registryd.err     # the ticks that could not be taken
```

Stop it, or reload it after editing the file:

```bash
launchctl bootout "gui/$(id -u)/com.plot-pm.registryd"
```

**Two repositories need two labels.** `launchd` keys a job by the `Label` inside the plist, not by the filename: two files with one `Label` are one job, and the second `bootstrap` fails with `5: Input/output error`. Give the second checkout its own label when you start it:

```bash
PLOT_FLEET_LABEL=com.plot-pm.registryd.other-repo skills/plot/scripts/plot-fleetctl.sh --start
```

`--start` fills the label into the plist and names the file after it. Set the same variable for `--status` and `--stop` in that checkout.

**An installed unit does not update itself.** A unit installed before `__LABEL__` existed keeps the label it was loaded under, and `--stop` under a new override cannot find it. Boot it out by its old label, remove its file, and start again under the override:

```bash
launchctl bootout "gui/$(id -u)/com.plot-pm.registryd"
rm ~/Library/LaunchAgents/com.plot-pm.registryd.plist
PLOT_FLEET_LABEL=<new> skills/plot/scripts/plot-fleetctl.sh --start
```

Alternatively, set `PLOT_FLEET_LABEL` to the old label, which adopts the existing unit.

## Install — Linux (`systemd`)

Run these from the repository you want supervised.

```bash
# 1. Where things are. Run `nvm use` first if you use nvm — the daemon needs Node 24.
REPO_ROOT="$(git rev-parse --show-toplevel)"
NODE="$(command -v node)"
HARNESS_DIR="$(dirname "$(command -v "${PLOT_HARNESS:-claude}")")"   # check it printed a directory
REGISTRYD="$REPO_ROOT/skills/plot/scripts/board/plot-registryd.mjs"

# 2. Fill the template into your user units directory.
mkdir -p ~/.config/systemd/user
sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__HARNESS_DIR__|$HARNESS_DIR|g" \
    -e "s|__REGISTRYD__|$REGISTRYD|g" \
    "$REPO_ROOT/skills/plot/units/plot-registryd.service" \
    > ~/.config/systemd/user/plot-registryd.service

# 3. Enable and start it.
systemctl --user daemon-reload
systemctl --user enable --now plot-registryd
```

Check it (`plot-registryd` is the default unit name; a checkout started under `PLOT_FLEET_LABEL` has its own, see below):

```bash
systemctl --user status plot-registryd
journalctl --user -u plot-registryd -f            # the tick lines
journalctl --user -u plot-registryd -p err -f     # the ticks that could not be taken
```

Stop it, or reload it after editing the file:

```bash
systemctl --user restart plot-registryd    # after an edit, following daemon-reload
systemctl --user disable --now plot-registryd
```

**A user service, not a system one.** The daemon reaps worktrees and reads `~/.claude` transcripts, both of which belong to the person who dispatched the agents. Running it as root would give it write access to every desk on the machine to save typing `--user`.

**Surviving logout** needs one more command, because a user service stops when the last session ends:

```bash
sudo loginctl enable-linger "$USER"
```

**Two repositories need two units, and `PLOT_FLEET_LABEL` names the second.** systemd keys a unit by its filename, so `/plot-fleet` derives the filename from the label. The default label `com.plot-pm.registryd` keeps `plot-registryd.service`. Any other label loses a leading `com.plot-pm.registryd.`, has each character systemd refuses in a unit name replaced by `-`, and gains the prefix `plot-registryd-`: `PLOT_FLEET_LABEL=com.plot-pm.registryd.<name>` installs `plot-registryd-<name>.service`. `--start`, `--status` and `--stop` all use that name, so run each under the same label. By hand, copy the file to `plot-registryd-<name>.service` and enable that name; nothing in the unit is shared. A unit installed that way is the one `/plot-fleet` finds under the matching label.

## Reading the log

A tick that completed:

```
plot-registryd tick agents=3 left=3 reap=0 correct=0 person=0 defer=0 cost=3496ms
```

A tick that could not:

```
plot-registryd tick incomplete reason="spawn git ENOMEM" cost=812ms next=re-reads
```

The two are deliberately different lines rather than the same line with zeros. A tick that decided nothing and a tick that could not decide have identical counts and mean opposite things: one is a quiet estate, the other is a supervisor that is not supervising. `next=re-reads` is the recovery — the following tick reads the registry and the desks again from disk, and nothing carries over from the tick that failed.

Incomplete ticks go to **stderr**; completed ones go to stdout. Both units route the two streams separately, so watching the error stream alone shows exactly the ticks that could not be taken.

## Running it by hand

The unit is a convenience. The daemon is the same program either way:

```bash
node skills/plot/scripts/board/plot-registryd.mjs --once      # one tick, then exit
node skills/plot/scripts/board/plot-registryd.mjs --dry-run   # accepted; every run is one
node skills/plot/scripts/board/plot-registryd.mjs --max 3     # act on at most three agents
node skills/plot/scripts/board/plot-registryd.mjs --interval 30
node skills/plot/scripts/board/plot-registryd.mjs --start-agents  # and start them
```

`--once` exits `1` when the tick could not complete and `0` when it did, which is what an operator and a `Type=oneshot` unit read. The looping form never exits on an incomplete tick — its failure signal is the log, and exiting would hand the OS supervisor a restart it does not need for a reading that will be taken again in a minute.

**Deciding is the default and performing is opt-in.** The tick names every write it would make and makes none, so running it against a live estate is safe at any time.

**`--start-agents` is the one exception**, and it is the one write this daemon performs. A tick with a queue nothing can take starts free agents towards the board's own **Parallel agents** cap, read fresh every tick so the stepper and the daemon cannot give two answers to one question. Three desks per tick bound how fast it grows; the cap bounds how far. Every other write the tick names — a reap, a correction, a blocked marker, an assignment — is still decided and never performed, and a run without the flag changes nothing on the machine.

The flag is off in both unit templates. Turn it on by adding it to `ProgramArguments` (launchd) or `ExecStart` (systemd) once you have watched a few ticks and agree with what they decided.

## If it does not start

**`launchctl` reports the job but no log appears.** The unit's `PATH` must contain `node`, `git` and `gh`; `launchd` gives a job a minimal one. Check the arch prefix — the template lists `/opt/homebrew/bin` first, which is wrong for an Intel Mac.

**`systemctl --user status` shows `status=203/EXEC`.** `ExecStart`'s node path does not exist. An `nvm`-managed node lives under `~/.nvm/versions/node/<version>/bin/node`, and that path changes when you install a new version — the unit needs re-filling after an upgrade.

**The log says `supervising` and then nothing.** That is a correct quiet daemon. The first tick line arrives immediately; the next arrives 60 seconds later.

**Every tick reports incomplete with the same reason.** The reading is genuinely broken rather than transient. Reproduce it with `--once` in a terminal, where the same reason prints and the exit code is `1`.
