#!/usr/bin/env bash
# The receipt a lifecycle write leaves behind, and the ONE place it is written
# and read — sourced, not run, by the scripts that own a `State:` line and by
# `plot-state-gate.sh`, which refuses every other writer.
#
#   record_state_receipt <path> <value>   # the owning script, after its write
#   receipt_clears <path> <value>         # the gate, before it refuses
#
# WHY A RECEIPT RATHER THAN A COMMIT MESSAGE. `plot-state-gate.sh` sees a
# `git commit`, and every fact reachable from there — the message, the branch,
# the author — is one an agent types. A receipt is not: it names the file and
# the value the owning script decided, and the only way to produce a matching
# one is to have run that script. That is the difference between a gate and a
# rule, and this whole plan exists because a rule was walked past three times in
# one afternoon.
#
# WHAT IT DOES NOT PROVE. The receipt says *this value was written here by an
# owner*; it does not say the working tree still holds only that write. An agent
# that runs `/plot-approve` and then edits the same line again inside the same
# commit is not caught, and no receipt could catch it — the gate reads the
# staged value, so a second edit changes the value and the receipt stops
# matching. Only a re-write to the SAME value would pass, and that write is a
# no-op.
#
# MACHINE-LOCAL AND UNTRACKED. `.plot/state/` is gitignored for the reason
# `plot-boardctl.sh:83` gives: a receipt is true on the machine that made it,
# and a receipt travelling in a commit would clear the gate on every other
# checkout that pulled it.
#
# A RECEIPT IS SPENT WHEN IT CLEARS. `receipt_clears` deletes the one it
# matched, so a single `/plot-approve` licenses a single commit. Leaving it
# would let one approval clear a `sed` over the same line a week later.
#
# IT FAILS TOWARD REFUSING, and that is the opposite of `plot-phase-gate.sh`'s
# choice, deliberately: an unwritable state directory means no receipt exists,
# so `receipt_clears` answers false and the gate refuses with the command to
# run. The blast radius is one commit an operator repeats through the owning
# script, against a phase gate whose refusal would cost every commit in the
# repository.

# Where receipts live. One file per receipt, named by a hash of the path, so two
# lifecycle writes in one session never overwrite each other.
_receipt_dir() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  printf '%s\n' "$root/.plot/state/state-receipts"
}

# The receipt's identity is the repo-relative path. Hashed rather than
# flattened: a path is not a filename, and `docs/plans/x.md` and `docs-plans/x.md`
# must not collide.
_receipt_file() { # $1=repo-relative path
  local dir
  dir="$(_receipt_dir)" || return 1
  printf '%s/%s\n' "$dir" "$(printf '%s' "$1" | git hash-object --stdin 2>/dev/null)"
}

# $1 = path (absolute or relative), $2 = the value written.
record_state_receipt() {
  local path="$1" value="$2" root rel file
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  rel="$(_repo_relative "$path" "$root")" || return 0
  file="$(_receipt_file "$rel")" || return 0
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  printf '%s\t%s\n' "$rel" "$value" > "$file" 2>/dev/null || return 0
  return 0
}

# $1 = repo-relative path, $2 = the staged value. Prints nothing; exit 0 means
# an owner wrote exactly this, and the receipt is spent.
receipt_clears() {
  local rel="$1" value="$2" file recorded
  file="$(_receipt_file "$rel")" || return 1
  [ -f "$file" ] || return 1
  recorded="$(cut -f2 <"$file" 2>/dev/null)" || return 1
  [ "$recorded" = "$value" ] || return 1
  rm -f "$file" 2>/dev/null
  return 0
}

# A path as git names it. `git rev-parse` is not used: the file may be a scratch
# copy that has already been `mv`ed, and this must work on a path alone.
_repo_relative() { # $1=path $2=root
  local path="$1" root="$2" dir base
  case "$path" in
    /*) ;;
    *) path="$PWD/$path" ;;
  esac
  dir="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || return 1
  base="$(basename "$path")"
  root="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  case "$dir" in
    "$root") printf '%s\n' "$base" ;;
    "$root"/*) printf '%s/%s\n' "${dir#"$root"/}" "$base" ;;
    *) return 1 ;;
  esac
}
