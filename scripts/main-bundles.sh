#!/usr/bin/env bash
# The generated bundles on `main`: build them, compare them to HEAD, and either
# publish, warn or refuse. One script, so the decisions have a fixture test —
# workflow YAML has no test tier here.
#
#   main-bundles.sh publish [root]   build; commit changed bundles; push to main
#   main-bundles.sh pr [root]        build; a stale bundle is an error
#   main-bundles.sh main [root]      build; a stale bundle is a warning, except
#                                    on the build commit itself, where it fails
#   main-bundles.sh release [root]   build; a stale bundle refuses the tag
#
# THE GENERATED SET IS `build.mjs`'s `shipped*` DECLARATIONS, the derivation
# `check-bundle-attributes.sh` uses. Paths are staged one by one: the board
# directory also holds `README.md` and `plot-monitor.mjs`, written by hand, and
# a directory-wide `git add` would commit them.
#
# THE LOOP GUARD IS THE TREE, NOT THE AUTHOR. The App's own push starts the
# workflow again; that run builds, finds the bundles equal to HEAD and commits
# nothing.
#
# A REFUSED PUSH LOSES NOTHING. If `main` moved while the build ran, the push is
# refused and the script reports and exits 0: no rebase, no retry, no force. The
# run for the newer push builds the newer tree.
#
# THE LAG RULE. A build that differs from HEAD is normal for the one workflow
# run between a merge and the App's push, so `main` mode warns. When HEAD is the
# App's own build commit the workflow has already run, and a bundle that still
# differs means the build is not deterministic or the push dropped paths: `main`
# mode exits 1.
#
# BUILD_CMD (default `pnpm run build:board`) is the build; a fixture replaces it.
set -uo pipefail

mode="${1:-}"
case "$mode" in
  publish|pr|main|release) ;;
  *) echo "usage: main-bundles.sh publish|pr|main|release [root]" >&2; exit 2 ;;
esac

cd "${2:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

BUILD='packages/board/build.mjs'
BUILD_CMD="${BUILD_CMD:-pnpm run build:board}"
SUBJECT='plot: build the board artifact'

if [ ! -f "$BUILD" ]; then
  echo "::error::$BUILD is missing; the bundle set cannot be derived."
  exit 2
fi

generated=$(grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$BUILD" \
  | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" | sort -u)
if [ -z "$generated" ]; then
  echo "::error::no shipped bundles found in $BUILD; the derivation is blind."
  exit 2
fi
paths=()
while IFS= read -r p; do paths+=("$p"); done <<EOF
$generated
EOF

if ! eval "$BUILD_CMD"; then
  echo "::error::the bundle build failed."
  exit 2
fi

# Changed or untracked generated paths, one per line.
stale=$(git status --porcelain --untracked-files=all -- "${paths[@]}" | sed -E 's/^.{3}//')

if [ -z "$stale" ]; then
  echo "Board bundles are fresh."
  exit 0
fi

report() {
  echo "Stale board bundles: $(printf '%s' "$stale" | tr '\n' ' ')"
}

case "$mode" in
  pr)
    echo "::error::$(report) Run 'pnpm build:board' and commit the result."
    exit 1
    ;;
  release)
    echo "::error::$(report) Refusing to tag a release over stale bundles."
    exit 1
    ;;
  main)
    if [ "$(git log -1 --format=%s)" = "$SUBJECT" ]; then
      echo "::error::$(report) HEAD is the bundle build commit, so the build is not deterministic or the push dropped paths."
      exit 1
    fi
    echo "::warning::$(report) The bundle workflow publishes them."
    exit 0
    ;;
  publish)
    while IFS= read -r p; do git add -- "$p"; done <<EOF
$stale
EOF
    git commit -q -m "$SUBJECT" || { echo "::error::commit failed."; exit 2; }
    if git push origin HEAD:refs/heads/main; then
      echo "Pushed: $(report)"
    else
      echo "::warning::push to main was refused; main moved while the build ran. The run for the newer push builds the newer tree."
    fi
    exit 0
    ;;
esac
