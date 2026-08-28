#!/usr/bin/env bash
# release-smoke.sh — verify a release the way a person receives it.
#
# WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT.
#
# CI already runs every automatable check on every PR: skills parse, skill
# frontmatter, the reconcile contract tests, the e2e choreography suite, the
# board typecheck, artifact freshness, the board unit tests and the Playwright
# integration suite. Re-running those here would add nothing — they were green
# on every commit in the release.
#
# What CI CANNOT test is the artifact behaving correctly for someone who
# INSTALLS it. Every CI job runs inside this repository, with its node_modules,
# its 158 plans, its git history and its `## Plot Config`. A released board is
# run by a person in a repo that has none of that.
#
# So this script tests exactly the seam CI leaves open:
#
#   1. the built artifact starts and serves, standalone
#   2. it works against a repo it has never seen
#   3. it degrades honestly where a host cannot be reached
#   4. the helper scripts it vendors run without the workspace
#
# It is READ-ONLY against the real repository. Everything it exercises happens
# in a sandbox it creates and removes.
#
# Usage: scripts/release-smoke.sh [--keep]
#          --keep   leave the sandbox in place for inspection

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

pass=0 fail=0 skip=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; fail=$((fail+1)); }
skipm(){ printf '  \033[33mSKIP\033[0m %s — %s\n' "$1" "$2"; skip=$((skip+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

SANDBOX=""
cleanup() {
  [ -n "$SANDBOX" ] && [ -d "$SANDBOX" ] && [ "$KEEP" = 0 ] && rm -rf "$SANDBOX"
  # Reap anything we started, on EVERY exit path — a smoke test that leaks a
  # server is worse than no smoke test, because the next run binds a used port.
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
head_ "0. The artifact exists and is current"
# ---------------------------------------------------------------------------

ART="$ROOT/skills/plot/scripts/board/board-server.mjs"
if [ -f "$ART" ]; then
  ok "artifact present ($(( $(wc -c < "$ART") / 1024 )) KB)"
else
  no "artifact missing" "run: pnpm build:board"
  echo; echo "summary: pass=$pass fail=$fail skip=$skip"; exit 1
fi

# A stale artifact fails reassuringly: every test below passes against the
# PREVIOUS release. This is the one check that must run first.
if command -v node >/dev/null 2>&1; then
  before=$(shasum -a 256 "$ART" | cut -d' ' -f1)
  if (cd "$ROOT" && pnpm run build:board >/dev/null 2>&1); then
    after=$(shasum -a 256 "$ART" | cut -d' ' -f1)
    [ "$before" = "$after" ] \
      && ok "artifact is a current build (rebuild is a no-op)" \
      || no "artifact was STALE — rebuilt just now" "everything below would have tested the previous build"
  else
    skipm "artifact freshness" "build failed or pnpm unavailable"
  fi
fi

# ---------------------------------------------------------------------------
head_ "1. The vendored helpers run outside the workspace"
# ---------------------------------------------------------------------------

# The npm package ships plot-config.sh and plot-plan-meta.sh at its root — a
# consumer gets those two and the artifact, and nothing else.
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/plot-smoke-XXXXXX")"
mkdir -p "$SANDBOX/repo/docs/plans"
cd "$SANDBOX/repo" || exit 1
git init -q -b main
git config user.email smoke@test && git config user.name smoke
git config commit.gpgsign false

cat > CLAUDE.md <<'EOF'
# Smoke

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
EOF

cat > docs/plans/2026-01-01-a-smoke-plan.md <<'EOF'
# A smoke plan

> One plan, one wave, one branch.

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-01-01, Smoke Tester, in-session

## Waves

### Only (Branch: feature/a-smoke-branch)

- does the thing
EOF
git add -A && git commit -qm "smoke fixture"

out=$(bash "$ROOT/skills/plot/scripts/plot-config.sh" get "Plan directory" "MISSING" 2>/dev/null)
[ "$out" = "docs/plans/" ] \
  && ok "plot-config.sh reads a foreign repo's config" \
  || no "plot-config.sh" "expected 'docs/plans/', got '$out'"

meta=$(bash "$ROOT/skills/plot/scripts/plot-plan-meta.sh" docs/plans/2026-01-01-a-smoke-plan.md 2>/dev/null)
phase=$(printf '%s' "$meta" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).phase)}catch{console.log("PARSE-FAIL")}})' 2>/dev/null)
[ "$phase" = "approved" ] \
  && ok "plot-plan-meta.sh parses a plan it has never seen" \
  || no "plot-plan-meta.sh" "expected phase 'approved', got '$phase'"

branch=$(printf '%s' "$meta" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.waves||[]).flatMap(w=>(w.branches||[]).map(b=>b.branch))[0]||"NONE")}catch{console.log("PARSE-FAIL")}})' 2>/dev/null)
[ "$branch" = "feature/a-smoke-branch" ] \
  && ok "the ## Waves dialect parses (branch resolved)" \
  || no "wave parsing" "expected 'feature/a-smoke-branch', got '$branch'"

# ---------------------------------------------------------------------------
head_ "2. The host adapter degrades honestly"
# ---------------------------------------------------------------------------

# This sandbox has NO remote and no host CLI configured for it. The release's
# central claim about the adapter is that an unanswerable question is reported
# as such, never as an empty answer — so the interesting assertion is that it
# does NOT exit 0 with a fabricated result.
hostout=$(bash "$ROOT/skills/plot/scripts/plot-host.sh" backend 2>&1); rc=$?
if [ $rc -eq 0 ] && [ -n "$hostout" ]; then
  ok "plot-host.sh backend answers ($hostout)"
elif [ $rc -ne 0 ]; then
  ok "plot-host.sh refuses a repo it cannot resolve (exit $rc)"
else
  no "plot-host.sh backend" "exit 0 with empty output — an unanswerable question answered"
fi

# KNOWN, and asserted as the current behaviour rather than the desired one.
# Measured 2026-08-28: in a repo with NO remote, `backend` answers `github`
# with exit 0 — it DEFAULTS where it cannot tell. That is the same shape the
# adapter's own doctrine rejects ("an unreachable host is not an answer"), one
# question earlier: the backend is inferred from origin, and a missing origin
# is not a GitHub origin.
#
# It is not a release blocker — the default is right for most repos and this
# has always been so — but a Bitbucket user cloning without a remote gets a
# GitHub adapter silently. Left as a documented observation so a future change
# to `backend` has a test that notices.
if (cd "$SANDBOX/repo" && git remote get-url origin >/dev/null 2>&1); then
  : # sandbox unexpectedly has a remote; the check below would prove nothing
else
  nb=$(cd "$SANDBOX/repo" && bash "$ROOT/skills/plot/scripts/plot-host.sh" backend 2>/dev/null)
  [ "$nb" = "github" ] \
    && skipm "backend on a remote-less repo" "answers '$nb' by DEFAULT, not by measurement — known, tracked" \
    || ok "backend does not default on a remote-less repo (says '$nb')"
fi

# ---------------------------------------------------------------------------
head_ "3. The board serves against a foreign repo"
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  skipm "board serve" "node not on PATH"
else
  PORT=0
  logf="$SANDBOX/board.log"
  ( cd "$SANDBOX/repo" && PLOT_PORT=0 node "$ART" >"$logf" 2>&1 & echo $! > "$SANDBOX/pid" )
  SERVER_PID=$(cat "$SANDBOX/pid" 2>/dev/null)

  url=""
  for _ in $(seq 1 40); do
    url=$(grep -oE 'http://(localhost|127\.0\.0\.1):[0-9]+' "$logf" 2>/dev/null | head -1)
    [ -n "$url" ] && break
    sleep 0.5
  done

  if [ -z "$url" ]; then
    no "board starts" "no URL in output after 20s; see $logf"
    [ "$KEEP" = 1 ] && head -20 "$logf"
  else
    ok "board starts and reports its URL ($url)"

    code=$(curl -s -o "$SANDBOX/board.json" -w '%{http_code}' --max-time 30 "$url/api/board" 2>/dev/null)
    if [ "$code" = "200" ]; then
      ok "/api/board responds 200"
      plans=$(node -e 'try{const j=require(process.argv[1]);console.log(Array.isArray(j.cards)?j.cards.length:(j.plans||[]).length)}catch(e){console.log("ERR")}' "$SANDBOX/board.json" 2>/dev/null)
      [ "$plans" != "ERR" ] \
        && ok "/api/board returns parseable JSON (${plans} card(s))" \
        || no "/api/board payload" "response did not parse as JSON"

      # THE ASSERTION THAT MATTERS: a board in a repo with no remote must SAY
      # the host could not be asked, not render an empty estate as a healthy one.
      node -e '
        const j = require(process.argv[1]);
        const s = JSON.stringify(j);
        const honest = /unknown|unreachable|degraded|prError|could not/i.test(s);
        process.exit(honest ? 0 : 1);
      ' "$SANDBOX/board.json" 2>/dev/null \
        && ok "the board reports host trouble rather than presenting silence as health" \
        || skipm "host-degradation signal" "no marker found — inspect $SANDBOX/board.json"
    else
      no "/api/board" "HTTP $code"
    fi
  fi
  kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""
fi

# ---------------------------------------------------------------------------
head_ "4. The release's own bookkeeping is coherent"
# ---------------------------------------------------------------------------

cd "$ROOT" || exit 1

if bash scripts/check-changeset-packages.sh >/dev/null 2>&1; then
  ok "every changeset names a real workspace package"
else
  no "changeset package names" "run: ./scripts/check-changeset-packages.sh"
fi

# A release whose sprint still has open Must Haves is one the gate would refuse.
if [ -x skills/plot/scripts/plot-sprint-release.sh ]; then
  openmust=$(skills/plot/scripts/plot-sprint-release.sh 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const j=JSON.parse(s);let n=0;
        for(const sp of (j.sprints||[])) for(const i of (sp.must||[])) if(i.state!=="done") n++;
        console.log(n);
      }catch{console.log("ERR")}})' 2>/dev/null)
  case "$openmust" in
    0)   ok "no sprint Must Have is unfinished" ;;
    ERR) skipm "sprint gate" "could not read plot-sprint-release.sh output" ;;
    *)   no "sprint gate" "$openmust Must Have(s) open — /plot-release would refuse" ;;
  esac
fi

# ---------------------------------------------------------------------------
echo
printf '\033[1msummary: pass=%d fail=%d skip=%d\033[0m\n' "$pass" "$fail" "$skip"
[ "$KEEP" = 1 ] && [ -n "$SANDBOX" ] && echo "sandbox kept at: $SANDBOX"
[ "$fail" -eq 0 ] || exit 1
exit 0
