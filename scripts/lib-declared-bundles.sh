#!/usr/bin/env bash
# THE ONE PARSER FOR "WHAT DOES build.mjs DECLARE?" — sourced, not run.
#
# `check-decision-count.sh` and `check-helper-table.sh` both need the set of
# `board/<name>.mjs` bundles `packages/board/build.mjs` declares, because a PR
# carries no built bundle (`check-no-bundle-diff.sh`) — only the declaration is
# evidence a PR can hold. A second awk parser drifts when `build.mjs` changes
# shape, so this is the only place that reads it.
#
# A declaration is a `const shipped<Name>` path to
# skills/plot/scripts/board/<name>.mjs plus an esbuild call whose
# `entryPoints` path and `outfile` (a `const` bound to dist/<name>.mjs) name
# the same bundle, copied to the shipped path with `fs.copyFileSync`.
#
#   read_declared_bundles <root> <fail-fn>
#
# Prints "board/<name>.mjs<TAB><entry path relative to packages/board/>" per
# declared bundle, one per line, to stdout. <fail-fn> is called with the
# reason when build.mjs is absent at HEAD in <root>, or declares nothing this
# parser can read — the caller's own `fail`, so the message carries the
# caller's prefix and exit behaviour.
#
# shellcheck shell=bash

read_declared_bundles() { # <root> <fail-fn>
  local root=$1 fail_fn=$2 build=packages/board/build.mjs text out
  text=$(git -C "$root" show "HEAD:$build" 2>/dev/null) || {
    "$fail_fn" "$build is absent at HEAD, so no declared bundle can be read as evidence."
    return 1
  }
  out=$(printf '%s\n' "$text" | awk -v q="'" '
    function quoted(s) { sub("^[^" q "]*" q, "", s); sub(q ".*$", "", s); return s }
    BEGIN {
      shipped_re = "^const shipped[A-Za-z]* = path\\.join\\(here, " q "\\.\\./\\.\\./skills/plot/scripts/board/[^" q "]+\\.mjs" q "\\);"
      dist_re = "^const [A-Za-z]+ = path\\.join\\(here, " q "dist/[^" q "]+\\.mjs" q "\\);"
      entry_re = "^[ \t]+entryPoints: \\[path\\.join\\(here, " q "[^" q "]+" q "\\)\\],?[ \t]*$"
      out_re = "^[ \t]+outfile: [A-Za-z]+,?[ \t]*$"
      copy_re = "^[ \t]*fs\\.copyFileSync\\([A-Za-z]+, *[A-Za-z]+\\);"
      inblock = 0
    }
    # A call opens on a line holding esbuild.build({ and closes on the first
    # }); at the same indent; entry and outfile are read only between the two.
    !inblock && /esbuild\.build\(\{[ \t]*$/ {
      inblock = 1; entry = ""; outv = ""
      indent = $0; sub(/[^ \t].*$/, "", indent)
      next
    }
    inblock {
      if ($0 == indent "});") {
        if (entry != "" && outv != "") calls[++n] = outv "\t" entry
        inblock = 0; entry = ""; outv = ""
      } else if ($0 ~ entry_re) entry = quoted($0)
      else if ($0 ~ out_re) { outv = $2; sub(/,$/, "", outv) }
      next
    }
    $0 ~ shipped_re { p = quoted($0); sub(/^.*\/board\//, "", p); shipped[$2] = p; next }
    $0 ~ dist_re { p = quoted($0); sub(/^dist\//, "", p); dist[$2] = p; next }
    $0 ~ copy_re {
      c = $0; sub(/^[^(]*\(/, "", c); sub(/\).*$/, "", c); split(c, cp, / *, */)
      copied[cp[1] SUBSEP cp[2]] = 1
      next
    }
    END {
      for (i = 1; i <= n; i++) {
        split(calls[i], f, "\t")
        if (!(f[1] in dist)) continue
        for (s in shipped) if ((f[1] SUBSEP s) in copied) printf "board/%s\t%s\n", shipped[s], f[2]
      }
    }
  ')
  if [ -z "$out" ]; then
    "$fail_fn" "$build at HEAD declares no bundle this gate can parse, so the declarations cannot serve as evidence. Fix the parser in lib-declared-bundles.sh, not the build."
    return 1
  fi
  printf '%s\n' "$out"
}

# EVERY BUNDLE THE BUILD WRITES, not only the ones it compiles itself.
#
#   read_shipped_bundles <root> <fail-fn>
#
# Prints "board/<name>.mjs" per `const shipped<Name>` path to
# skills/plot/scripts/board/<name>.mjs that build.mjs copies to with
# `fs.copyFileSync(<artifact>, shipped<Name>)`, one per line. A declaration
# may wrap its `path.join(` arguments over several lines. A shipped path that
# no copy writes is not printed. <fail-fn> is called as above.
#
# `read_declared_bundles` prints only a bundle whose esbuild call sits in
# build.mjs, because `check-decision-count.sh` needs its entry path. A bundle
# that `@plot-pm/fleet` compiles and build.mjs only copies has no such call.
# Measured on `main` at 20c7e04cc: build.mjs writes 80 bundles, and 13 of them
# (`plot-fleetd.mjs`, `plot-worker-loop.mjs`, `plot-dispatch-command.mjs`, …)
# have no esbuild call there that the parser above reads.
# `check-helper-table.sh` reads this function, so the PR that adds such a
# bundle needs its row before main's build commit adds the file.
read_shipped_bundles() { # <root> <fail-fn>
  local root=$1 fail_fn=$2 build=packages/board/build.mjs text out
  text=$(git -C "$root" show "HEAD:$build" 2>/dev/null) || {
    "$fail_fn" "$build is absent at HEAD, so no declared bundle can be read as evidence."
    return 1
  }
  out=$(printf '%s\n' "$text" | awk -v q="'" '
    function quoted(s) { sub("^[^" q "]*" q, "", s); sub(q ".*$", "", s); return s }
    function decl(s,   name, p) {
      if (!match(s, path_re)) return
      name = s; sub(/^const /, "", name); sub(/ .*$/, "", name)
      p = quoted(substr(s, RSTART)); sub(/^.*\/board\//, "", p)
      shipped[name] = p
    }
    BEGIN {
      open_re = "^const shipped[A-Za-z]* = path\\.join\\("
      path_re = q "\\.\\./\\.\\./skills/plot/scripts/board/[^" q "]+\\.mjs" q
      copy_re = "^[ \t]*fs\\.copyFileSync\\([A-Za-z]+, *[A-Za-z]+\\);"
      pending = ""
    }
    # A wrapped declaration joins its lines up to the one that closes it.
    pending != "" {
      pending = pending " " $0
      if ($0 ~ /\);/) { decl(pending); pending = "" }
      next
    }
    $0 ~ open_re {
      if ($0 ~ /\);/) decl($0); else pending = $0
      next
    }
    $0 ~ copy_re {
      c = $0; sub(/^[^(]*\(/, "", c); sub(/\).*$/, "", c); split(c, cp, / *, */)
      copied[cp[2]] = 1
      next
    }
    END { for (s in shipped) if (s in copied) printf "board/%s\n", shipped[s] }
  ' | sort -u)
  if [ -z "$out" ]; then
    "$fail_fn" "$build at HEAD declares no bundle this gate can parse, so the declarations cannot serve as evidence. Fix the parser in lib-declared-bundles.sh, not the build."
    return 1
  fi
  printf '%s\n' "$out"
}
