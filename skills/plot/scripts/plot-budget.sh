#!/usr/bin/env bash
# Plot helper: the budget record's SHELL half — what this computer has spent,
# per (connector, account, bucket).
#
# SOURCED, NOT RUN, by `plot-host.sh`. `. "$here/plot-budget.sh"` defines
# `budget_path`, `budget_append` and `budget_rate`; the file does nothing else
# on load. Same shape and same reason as `plot-pr-merged.sh` and
# `plot-worker-state.sh`: the caller parses its own `$@`, so a file that ran an
# argument parser at load time could not be sourced.
#
# IT APPENDS AND READS, AND IT NEVER PRUNES. Truncation is the one write that is
# not an append, and it belongs to the `BudgetRecord` port's `truncate()` — a
# second pruning path in shell would rewrite the file while the port's reader
# believed it held the lines it had just proven dead. The shell writes the
# record; the domain is what cleans it.
#
# WHY A SECOND IMPLEMENTATION OF A FORMAT THE DOMAIN ALREADY ENCODES. The
# spenders are eleven shell scripts, a board and a person at a terminal, and
# only the board is TypeScript. A shell that had to start `node` to record one
# call would add ~40 ms and a runtime dependency to every host call plot makes —
# on the hot path, to write one line. So the format is written twice and pinned
# by a test that decodes shell output with `decodeEntry`: the drift risk is
# real, and a contract test is the answer to it rather than a slower appender.
#
# THE FORMAT IS `packages/domain/src/entities/budget.ts`'s AND NOT THIS FILE'S.
# Ten tab-separated fields behind a `b1` marker:
#
#   b1 <connector> <account> <bucket> <at-ms> <spent> <limit> <remaining> <reset-ms> <basis>
#
# `-` is the absent marker, and ABSENT IS NOT ZERO: a `remaining` of 0 means
# the bucket is spent and every call is refused, while `-` means the connector
# did not say. Writing null as 0 would make silence read as exhaustion.
#
# APPEND-ONLY AND LOCK-FREE, AND THE LINE CAP IS WHY. Concurrent `O_APPEND` is
# atomic only below `PIPE_BUF`, which `getconf PIPE_BUF /` reports as **512**
# on this fleet's macOS machines — not the 4096 a reader assuming Linux would
# take. So every line is measured before it is written and an over-long one is
# REFUSED rather than shortened: a torn line loses the concurrent writer's line
# too, so dropping one spend is cheaper than corrupting another's.
#
# THE BUCKET IS THE CONNECTOR'S OWN WORD, AND ONE CONNECTOR HAS SEVERAL. GitHub
# meters `core` and `graphql` as independent 5000-request pools, named by
# `X-RateLimit-Resource` on the response of a call that was going to happen
# anyway. Measured 2026-09-01 on one account at one moment: `core` 4990 of 5000,
# `graphql` **0** of 5000. A record keyed to one undifferentiated pool describes
# neither — it reports room while every `gh pr` call is refused, and refuses
# calls that would have gone to the pool with 4990 left. Nothing here validates
# the name: a connector nobody has written an adapter for names a third thing.
#
# THE RECORD IS THE COMPUTER'S, NOT THE CHECKOUT'S. Measured 2026-09-01: two
# GitHub checkouts on this computer share the account `jwloka`, so a
# per-checkout `.plot/state/` would let each read a full 5000 while the other
# spent it — the over-spend the record exists to prevent, reproduced by storing
# it in the wrong place. `$PLOT_BUDGET_HOME` is the ONE override, and it is the
# same variable `budget-file.ts` reads.

# The record's directory, then its file. Nothing here reads a repository root, a
# git directory or a working directory — that absence is the fix.
budget_path() {
  local home="${PLOT_BUDGET_HOME:-}"
  if [ -z "$home" ]; then
    [ -n "${HOME:-}" ] || return 1
    home="$HOME/.plot/state"
  fi
  printf '%s\n' "$home/budget.tsv"
}

# The most bytes one appended line may occupy, newline included. Mirrors
# `MAX_LINE_BYTES` in `packages/domain/src/entities/budget.ts`, and a test pins
# the two together.
BUDGET_MAX_LINE_BYTES=512

# Strips what the format cannot carry from a key part. A tab would add a field
# and a newline would add a line, so both are replaced rather than escaped: the
# only inputs are a connector, an account and a bucket name, none of which any
# connector spells with whitespace.
budget_clean() {
  printf '%s' "$1" | tr '\t\r\n' '___'
}

# A number, or the absent marker for anything that is not one. A non-numeric
# reading is ABSENT rather than zero, for the reason above.
budget_num() {
  case "$1" in
    ''|'-') printf '%s' '-' ;;
    *) if [[ "$1" =~ ^-?[0-9]+$ ]]; then printf '%s' "$1"; else printf '%s' '-'; fi ;;
  esac
}

# Now, in epoch milliseconds.
#
# `EPOCHREALTIME` FIRST, BECAUSE IT COSTS NO PROCESS. It is a bash 5 builtin
# holding `seconds.microseconds`, so the milliseconds are a substring — and this
# runs beside every host call, where a `fork`+`exec` per line is a cost the
# record should not impose.
#
# THE FALLBACK IS SECONDS, AND IT IS NOT MERELY DEFENSIVE. macOS ships bash 3.2
# at `/bin/bash`, where `EPOCHREALTIME` does not exist; `date +%s%3N` is GNU-only
# and prints a literal `3N` on the BSD `date` beside it, which would write a
# timestamp no reader can decode. So seconds are read portably and multiplied.
#
# SECOND RESOLUTION COSTS A SPAN, NOT A COUNT. Several lines inside one second
# share a timestamp, so a window holding only those reports `spanMs: 0` and
# `perHour: null` — an absent rate, which is the honest answer to *how fast* when
# the record cannot yet say. The spend COUNT is exact either way, and a window
# wide enough to divide a cadence by spans minutes rather than milliseconds.
budget_now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    # `1788341828.708210` → `1788341828708`. The locale decides the separator,
    # so both are matched rather than assuming a dot.
    local whole frac
    whole="${EPOCHREALTIME%%[.,]*}"
    frac="${EPOCHREALTIME#*[.,]}"
    if [ "$frac" != "$EPOCHREALTIME" ]; then
      frac="${frac}000"
      printf '%s%s\n' "$whole" "${frac:0:3}"
      return
    fi
  fi
  printf '%s000\n' "$(date +%s)"
}

# Appends one line: what a call spent, and what the response said.
#
#   budget_append <connector> <account> <bucket> <spent> <limit> <remaining> <reset-seconds> <basis>
#
# `limit`, `remaining` and `reset` may be empty or `-` where the connector did
# not report them; `reset` is epoch SECONDS in, epoch MILLISECONDS on disk,
# matching what `plot-host.sh limit` prints and what `budget.ts` stores.
#
# NEVER FAILS ITS CALLER. Recording is bookkeeping beside a host call that has
# already happened, so a record that cannot be written must not turn a
# successful call into a failed one. Every failure path returns 0 after writing
# nothing; a caller that wants to know asks `budget_rate`.
budget_append() {
  local connector="${1:-}" account="${2:-}" bucket="${3:-}" spent="${4:-1}"
  local limit="${5:-}" remaining="${6:-}" reset="${7:-}" basis="${8:-unknown}"
  local path line reset_ms

  # A basis this record does not know degrades to `unknown`, the same direction
  # `limitOf` degrades in: a word nobody has seen must never arrive as `actual`,
  # which is the one basis a caller is entitled to trust.
  case "$basis" in
    actual|predicted|unknown) ;;
    *) basis=unknown ;;
  esac

  # An `unknown` basis carries a null limit whatever was passed. The two would
  # otherwise be able to disagree, and a number tagged *unknown* is the collapse
  # slice 1 exists to refuse.
  if [ "$basis" = unknown ]; then limit=''; fi

  reset_ms='-'
  if [ -n "$reset" ] && [ "$reset" != '-' ] && [[ "$reset" =~ ^[0-9]+$ ]]; then
    reset_ms="${reset}000"
  fi

  path="$(budget_path)" || return 0
  line="$(printf 'b1\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' \
    "$(budget_clean "$connector")" \
    "$(budget_clean "$account")" \
    "$(budget_clean "$bucket")" \
    "$(budget_now_ms)" \
    "$(budget_num "$spent")" \
    "$(budget_num "$limit")" \
    "$(budget_num "$remaining")" \
    "$reset_ms" \
    "$basis")"

  # MEASURED IN BYTES, NOT CHARACTERS, and the newline counts. `LC_ALL=C wc -c`
  # counts what the kernel writes; a UTF-8 account name costs more than its
  # length, and the cap is the kernel's guarantee.
  local bytes
  bytes="$(printf '%s\n' "$line" | LC_ALL=C wc -c | tr -d ' ')"
  if [ "${bytes:-0}" -gt "$BUDGET_MAX_LINE_BYTES" ]; then
    # REFUSED, NOT TRUNCATED, and it says so. Shortening the line would write a
    # spend against a key nobody can read back, and a silent refusal would make
    # a systematically over-long key look like an idle account.
    echo "plot-budget: refusing a ${bytes}-byte line over the ${BUDGET_MAX_LINE_BYTES}-byte cap — this call went unrecorded (connector=$connector bucket=$bucket)" >&2
    return 0
  fi

  mkdir -p "$(dirname "$path")" 2>/dev/null || return 0
  # ONE `printf`, ONE `>>`. The redirection opens with `O_APPEND` and the single
  # write is what the atomicity guarantee is about; two writes could interleave
  # however short each was.
  printf '%s\n' "$line" >>"$path" 2>/dev/null || true
  return 0
}

# How many calls this budget spent inside its window, and how fast.
#
#   budget_rate <connector> <account> <bucket> [now-ms]
#
# Prints one JSON object:
#   {"spent":N,"spanMs":N,"perHour":N|null,"lines":N,"unreadable":N,
#    "limit":N|null,"remaining":N|null,"basis":"actual|predicted|unknown"}
#
# OVER THE CONNECTOR'S WINDOW, NEVER THE WHOLE FILE, and that is the whole
# reason the window exists. Measured 2026-09-01, one board at 5 s and eleven
# scripts at 90 s append ~1,160 lines an hour: a rate divided by an
# ever-growing span approaches zero, which relaxes the cadence forever — the
# opposite of what the record is for.
#
# THE WINDOW IS READ FROM A RESET THAT HAS PASSED, never computed from one still
# in the future. A reset an hour out, minus an hour, lands on `now` and would
# discard every line ever written. Same rule as `windowStart` in
# `packages/domain/src/rules/budget-record.ts`, and a test pins them together.
BUDGET_FALLBACK_WINDOW_MS=3600000

# AN EMPTY BUCKET MEANS EVERY BUCKET, and that is the account-wide question
# rather than a missing argument. One connector meters several pools
# independently — GitHub's `core` and `graphql` — and a caller asking *how fast
# is this account going?* is asking about all of them: an account spends every
# bucket it has, and a cadence divided by one pool's rate would ignore the
# traffic on the other.
#
# THE VERDICT IS NOT SUMMED, and the aggregate deliberately does not report one.
# `remaining` and `basis` describe the NEWEST live line across the buckets,
# which is a reading about whichever pool was spent last — so a caller deciding
# whether a bucket is spent must name that bucket. `graphql_budget_spent` does,
# and this is why.
budget_rate() {
  local connector="${1:-}" account="${2:-}" bucket="${3:-}" now="${4:-}"
  local path
  [ -n "$now" ] || now="$(budget_now_ms)"
  path="$(budget_path)" || { echo '{"spent":0,"spanMs":0,"perHour":null,"lines":0,"unreadable":0,"limit":null,"remaining":null,"basis":"unknown"}'; return 0; }

  # A MISSING FILE IS AN EMPTY RECORD, not a failure — absence is the state of
  # every computer that has not spent yet, and reporting it as broken would make
  # a fresh checkout look faulty.
  if [ ! -f "$path" ]; then
    echo '{"spent":0,"spanMs":0,"perHour":null,"lines":0,"unreadable":0,"limit":null,"remaining":null,"basis":"unknown"}'
    return 0
  fi

  LC_ALL=C awk -v want_c="$connector" -v want_a="$account" -v want_b="$bucket" \
      -v now="$now" -v fallback="$BUDGET_FALLBACK_WINDOW_MS" '
    BEGIN { FS = "\t"; unreadable = 0; n = 0; passed = -1 }
    {
      # A NULL IS THE NORMAL CASE, not an error. The file is appended to by
      # processes that may be killed mid-write, so a torn tail, a blank line and
      # a line from a newer format are all things a reader meets — and every one
      # is skipped rather than thrown on. A reader that failed on one bad line
      # would report the whole account as unreadable, which reads as headroom.
      if ($0 == "") next
      if (NF != 10 || $1 != "b1") { unreadable++; next }
      if ($2 != want_c || $3 != want_a) next
      if (want_b != "" && $4 != want_b) next
      at = $5 + 0
      if ($5 !~ /^-?[0-9]+$/) { unreadable++; next }
      n++
      c_at[n] = at; c_spent[n] = ($6 ~ /^-?[0-9]+$/) ? $6 + 0 : 0
      c_limit[n] = $7; c_rem[n] = $8; c_basis[n] = $10
      # The latest reset that has ALREADY happened is where the live window
      # starts: every line older than it describes a bucket that no longer
      # exists. A reset still in the future says only that the window has not
      # closed, and says nothing about when it opened.
      if ($9 ~ /^[0-9]+$/) { r = $9 + 0; if (r <= now && r > passed) passed = r }
    }
    END {
      from = now - fallback
      if (passed >= 0 && passed > from) from = passed
      spent = 0; oldest = -1; newest = -1
      limit = "null"; remaining = "null"; basis = "unknown"
      for (i = 1; i <= n; i++) {
        if (c_at[i] < from) continue
        spent += c_spent[i]
        if (oldest < 0 || c_at[i] < oldest) oldest = c_at[i]
        # The newest LIVE line is the current reading. A line the reset has
        # killed describes a bucket that no longer exists, so reading it as the
        # current state would report a spent bucket long after it refilled.
        if (newest < 0 || c_at[i] >= newest) {
          newest = c_at[i]
          limit = (c_limit[i] ~ /^-?[0-9]+$/) ? c_limit[i] : "null"
          remaining = (c_rem[i] ~ /^-?[0-9]+$/) ? c_rem[i] : "null"
          basis = c_basis[i]
          if (basis != "actual" && basis != "predicted" && basis != "unknown") basis = "unknown"
          # `unknown` IS NOT HEADROOM. A stored number tagged unknown is not a
          # reading, so it is reported as absent rather than as room.
          if (basis == "unknown") { limit = "null"; remaining = "null" }
        }
      }
      span = (oldest < 0) ? 0 : now - oldest
      if (span < 0) span = 0
      if (span > 0) {
        rate = sprintf("%.2f", spent * fallback / span)
      } else {
        # NO SPAN, NO RATE. One line, or several written in the same
        # millisecond, divides by zero — and an invented rate would be the
        # cadence input this slice exists to make honest.
        rate = "null"
      }
      printf "{\"spent\":%d,\"spanMs\":%d,\"perHour\":%s,\"lines\":%d,\"unreadable\":%d,\"limit\":%s,\"remaining\":%s,\"basis\":\"%s\"}\n", \
        spent, span, rate, n, unreadable, limit, remaining, basis
    }
  ' "$path" 2>/dev/null || echo '{"spent":0,"spanMs":0,"perHour":null,"lines":0,"unreadable":0,"limit":null,"remaining":null,"basis":"unknown"}'
}
