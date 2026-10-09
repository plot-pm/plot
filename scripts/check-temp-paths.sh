#!/usr/bin/env bash
# THE GATE THAT KEEPS EVERY SCRIPT TEMP PATH UNDER `TMPDIR`, WITH ONE OWNER.
#
# `skills/plot/scripts/plot-tmp.sh` is the ONE place a shipped script creates a
# temp path and the ONE place that installs an EXIT, INT or TERM trap. Measured
# 2026-09-30: 14 `mktemp` sites, five of them template-less, which on macOS
# write to `_CS_DARWIN_USER_TEMP_DIR` whatever `TMPDIR` says; nine fixed-name
# `/tmp` paths; and 8 traps in 7 scripts, two of them in `plot-fleet-scan.sh`,
# where the second replaced the first and every scan left one ~955-file `tmp.*`
# directory behind.
#
# In `skills/plot/scripts/*.sh`, outside `plot-tmp.sh`, it refuses:
#
#   - any `mktemp` call — use `plot_tmpdir VAR prefix` / `plot_tmpfile VAR prefix`;
#   - any non-comment line holding a fixed `/tmp/` literal, in a redirection, an
#     argument, or an assignment a later line writes through;
#   - `$(plot_tmpdir` and `$(plot_tmpfile` — the substitution form removes or
#     leaks the path, so the helpers assign by name;
#   - any `trap` naming EXIT, INT, TERM or 0 — use `plot_on_exit command`.
#
# In `skills/plot/scripts/*.sh` AND `scripts/*.sh` it refuses a DELETE BY GLOB
# IN A SHARED TEMP DIRECTORY. On 2026-09-30 a probe ran
# `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*` and removed every `tmp.*`
# entry in an operator's real temp directory. So:
#
#   - an `rm` whose arguments name `$TMPDIR`, `${TMPDIR`, `/tmp`, `/var/folders`
#     or `$(getconf` and hold an UNQUOTED glob character;
#   - `find … -delete`, `find … -exec rm` and `xargs rm`, outright.
#
# THE LINE IS READ THE WAY THE SHELL READS IT, NOT AS TEXT. Continuation lines
# and multi-line quotes are joined, heredoc bodies and comments are dropped, and
# for the glob rule every quoted span and every `${…}` becomes one token, so a
# quoted `*` and a `${TMPDIR:?}` guard pass while the incident's own form fails.
# A glob reached through a variable (`d=$TMPDIR; rm -rf $d/tmp.*`) is beyond
# this reading; for that shape the rule stays a rule.
#
# ---------------------------------------------------------------------------
# THE EXCEPTIONS, each matched by file, rule and a fragment of the line
# ---------------------------------------------------------------------------
#
# None today. `plot-reap.sh`'s `/private/tmp` normalisation moved to
# `packages/board/src/server/entry/reap.ts` with `the-reaper-becomes-a-command`
# — outside the trees this gate scans — and the shell file left behind is a
# launcher with no temp-path handling of its own.
#
# An exception whose file exists and whose line no longer matches FAILS the
# gate, so the list can only shrink.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root lets test/reconcile/temp-paths-gate.test.mjs prove the refusals.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

EXCEPTIONS=''

files=""
for f in skills/plot/scripts/*.sh scripts/*.sh; do
  [ -f "$f" ] && files="$files$f
"
done
[ -n "$files" ] || { echo "Temp paths: no scripts found under $(pwd)."; exit 0; }

report=$(printf '%s' "$files" | tr '\n' '\0' | PLOT_TEMP_EXCEPTIONS="$EXCEPTIONS" xargs -0 awk '
function reset_file() {
  depth = 1; st[1] = "c"; r = ""; s = ""; tok = ""; start = 0
  hd_n = 0; in_hd = 0; hd_i = 0
  base = FILENAME; sub(/^.*\//, "", base)
  scope_a = (FILENAME ~ /^skills\/plot\/scripts\/[^\/]+\.sh$/) && base != "plot-tmp.sh"
}
function quoted_ctx(   i) {
  for (i = 2; i <= depth; i++) if (st[i] == "s" || st[i] == "d" || st[i] == "v") return i
  return 0
}
function marker(text) {
  return (text ~ /TMPDIR|\/tmp|\/var\/folders|getconf/) ? "__TMPQ__" : "__Q__"
}
function emit_s(ch) { if (quoted_ctx()) tok = tok ch; else s = s ch }
function push(kind) { st[++depth] = kind }
function pop(   was) {
  was = quoted_ctx(); depth--
  if (was && !quoted_ctx()) { s = s marker(tok); tok = "" }
}
function hit(rule) {
  hits[++nhits] = FILENAME "\t" start "\t" rule "\t" r
}
# The arguments of the command that starts at `pos` in `s`: up to `;`, `&`, `|`
# or an unmatched `)` at depth 0.
function args_at(pos,   i, c, d, out) {
  d = 0; out = ""
  for (i = pos; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "(") d++
    else if (c == ")") { if (d == 0) break; d-- }
    else if ((c == ";" || c == "&" || c == "|") && d == 0) break
    out = out c
  }
  return out
}
function check(   rest, p, a, m) {
  if (scope_a) {
    if (r ~ /(^|[^A-Za-z0-9_.\/-])mktemp([^A-Za-z0-9_.-]|$)/) hit("mktemp")
    if (r ~ /\/tmp\//) hit("tmp-literal")
    if (r ~ /(\$\(|`)[ \t]*plot_tmp(dir|file)/) hit("substitution")
    rest = s
    while (match(rest, /(^|[;&|({ \t])trap[ \t]+/)) {
      a = substr(rest, RSTART + RLENGTH); rest = a
      m = a; sub(/[;&|].*$/, "", m)
      if ((" " m " ") ~ /[ \t](SIG)?(EXIT|INT|TERM|0)[ \t]/) { hit("trap"); break }
    }
  }
  rest = s; p = 0
  while (match(rest, /(^|[;&|({ \t])(command[ \t]+|\/bin\/)?rm[ \t]+/)) {
    p += RSTART + RLENGTH - 1
    a = args_at(p + 1)
    if (a ~ /__TMPQ__|\$TMPDIR|\/tmp|\/var\/folders|getconf/ && a ~ /[*?[]/) { hit("rm-glob"); break }
    rest = substr(s, p + 1)
  }
  if (s ~ /(^|[;&|({ \t])find[ \t][^;&|]*[ \t]-delete([ \t]|$)/) hit("find-delete")
  if (s ~ /(^|[;&|({ \t])find[ \t][^;&|]*-exec(dir)?[ \t]+(\/bin\/)?rm([ \t]|$)/) hit("find-exec-rm")
  if (s ~ /(^|[;&|({ \t])xargs[ \t][^;&|]*(^|[ \t])(\/bin\/)?rm([ \t]|$)/) hit("xargs-rm")
}
FNR == 1 { reset_file() }
{
  line = $0
  if (in_hd) {
    t = line; if (hd_strip[hd_i]) sub(/^\t+/, "", t)
    if (t == hd_delim[hd_i]) { hd_i++; if (hd_i > hd_n) { in_hd = 0; hd_n = 0 } }
    next
  }
  if (start == 0) start = FNR
  n = length(line); i = 1; cont = 0
  while (i <= n) {
    c = substr(line, i, 1); top = st[depth]
    prev = (i > 1) ? substr(line, i - 1, 1) : " "
    if (top == "s") {
      r = r c
      if (c == "\047") pop(); else emit_s(c)
      i++; continue
    }
    if (top == "d") {
      if (c == "\\" && i < n) { r = r c substr(line, i + 1, 1); emit_s(c substr(line, i + 1, 1)); i += 2; continue }
      if (c == "\"") { r = r c; pop(); i++; continue }
      if (c == "$" && substr(line, i + 1, 1) == "(") { r = r "$("; emit_s("$("); push("p"); i += 2; continue }
      if (c == "$" && substr(line, i + 1, 1) == "{") { r = r "${"; emit_s("${"); push("v"); i += 2; continue }
      r = r c; emit_s(c); i++; continue
    }
    if (top == "v") {
      r = r c; emit_s(c)
      if (c == "}") pop(); else if (c == "{") push("v")
      i++; continue
    }
    # code: the top level or inside $( … )
    if (c == "#" && prev ~ /[ \t;&|(){]/) break
    if (c == "\\") {
      if (i == n) { cont = 1; break }
      r = r c substr(line, i + 1, 1); emit_s("_"); i += 2; continue
    }
    if (c == "\047") { r = r c; if (prev == "$") {} push("s"); i++; continue }
    if (c == "\"") { r = r c; push("d"); i++; continue }
    if (c == "$") {
      nx = substr(line, i + 1, 1)
      if (nx == "{") { r = r "${"; push("v"); tok = tok "${"; i += 2; continue }
      if (nx == "(") { r = r "$("; emit_s("$("); push("p"); i += 2; continue }
      if (nx ~ /[?*#@!$0-9-]/) { r = r c nx; emit_s("__V__"); i += 2; continue }
    }
    if (c == "<" && substr(line, i, 3) != "<<<" && substr(line, i, 2) == "<<") {
      if (match(substr(line, i), /^<<-?[ \t]*[\047"]?[A-Za-z_][A-Za-z0-9_]*[\047"]?/)) {
        spec = substr(line, i, RLENGTH)
        hd_n++; hd_strip[hd_n] = (spec ~ /^<<-/)
        d = spec; sub(/^<<-?[ \t]*/, "", d); gsub(/[\047"]/, "", d); hd_delim[hd_n] = d
        r = r spec; emit_s(spec); i += RLENGTH; continue
      }
    }
    if (top == "p") {
      if (c == "(") push("p")
      else if (c == ")") { r = r c; emit_s(c); pop(); i++; continue }
    }
    r = r c; emit_s(c); i++
  }
  if (cont) next
  if (depth > 1) { r = r " "; emit_s(" "); next }
  check()
  r = ""; s = ""; tok = ""; start = 0
  if (hd_n > 0) { in_hd = 1; hd_i = 1 }
}
END {
  ne = split(ENVIRON["PLOT_TEMP_EXCEPTIONS"], exl, "\n")
  for (k = 1; k <= ne; k++) { split(exl[k], ef, "\t"); exf[k] = ef[1]; exr[k] = ef[2]; exs[k] = ef[3]; used[k] = 0 }
  for (h = 1; h <= nhits; h++) {
    split(hits[h], hf, "\t"); body = hits[h]; sub(/^[^\t]*\t[^\t]*\t[^\t]*\t/, "", body)
    ok = 0
    for (k = 1; k <= ne; k++)
      if (hf[1] == exf[k] && hf[3] == exr[k] && index(body, exs[k])) { ok = 1; used[k]++ }
    if (ok) continue
    gsub(/[ \t]+/, " ", body)
    printf "V\t%s:%s: [%s] %s\n", hf[1], hf[2], hf[3], body
  }
  for (k = 1; k <= ne; k++) printf "E\t%s\t%s\t%s\t%d\n", exf[k], exr[k], exs[k], used[k]
}
') || {
  # A gate that cannot read the scripts must not report them clean.
  echo "::error::check-temp-paths.sh could not scan the scripts (awk failed)."
  exit 2
}

violations=$(printf '%s\n' "$report" | sed -n 's/^V	//p')
stale=""
exempted=0
while IFS='	' read -r tag file rule frag used; do
  [ "$tag" = "E" ] || continue
  if [ "$used" -gt 0 ]; then
    exempted=$((exempted + used))
  elif [ -f "$file" ]; then
    stale="${stale}  ${file} [${rule}] ${frag}
"
  fi
done <<EOF
$report
EOF

echo "temp-path sites in the exception list: $exempted"

status=0
if [ -n "$violations" ]; then
  echo "::error::a script creates a temp path, installs an exit trap, or deletes by glob outside the rule."
  echo
  echo "Every temp path a Plot script creates goes through skills/plot/scripts/plot-tmp.sh:"
  echo "  plot_tmpdir VAR prefix     a directory under \$TMPDIR, removed at exit"
  echo "  plot_tmpfile VAR prefix    a file under \$TMPDIR, removed at exit"
  echo "  plot_on_exit command       a command run at exit (never a raw EXIT/INT/TERM trap)"
  echo "Assign by name: \`d=\$(plot_tmpdir x)\` removes or leaks the path."
  echo
  echo "Nothing deletes by glob in \$TMPDIR, /tmp or /var/folders: on 2026-09-30"
  echo "\`rm -rf \"\$(getconf DARWIN_USER_TEMP_DIR)\"tmp.*\` removed every tmp.* entry"
  echo "on an operator's machine. Remove a path you hold by its exact name."
  echo
  echo "Violations:"
  printf '%s\n' "$violations"
  status=1
fi
if [ -n "$stale" ]; then
  echo "::error::an exception in scripts/check-temp-paths.sh matches nothing; delete it."
  printf '%s' "$stale"
  status=1
fi
[ "$status" = 0 ] && echo "Temp paths: clean."
exit "$status"
