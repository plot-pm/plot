#!/usr/bin/env bash
# `AGENTS.md` IS `CLAUDE.md` FOR CODEX, AND THE TWO NEVER DISAGREE.
#
# Claude Code loads `CLAUDE.md`; Codex loads `AGENTS.md`. Until 2026-10-03 the
# second was a hand-kept copy, and measured that day it held 6 of 12 sections,
# 6 of 25 config keys and 11 of 20 skills. It also told agents to bump skill
# versions by hand, which `CLAUDE.md` replaced on 2026-08-17, and named a
# `.Codex-plugin/` directory that does not exist — a search-and-replace of
# "Claude" that reached file paths.
#
# THE RULE: `AGENTS.md` equals `CLAUDE.md` with every `CLAUDE.md` written as
# `AGENTS.md`, and nothing else differs. One substitution, because the hub's
# own file name is the only word that changes with the reader; a tool name such
# as `AskUserQuestion` or a dated fact such as "5 Claude Code sessions" stays
# true for every reader and is not rewritten.
#
# `CLAUDE.md` IS THE SOURCE. Edit it, then run `--write` to regenerate the
# mirror. An edit made to `AGENTS.md` alone is the drift this refuses.
#
#   ./scripts/check-agents-md.sh           exit 1 and print the diff on drift
#   ./scripts/check-agents-md.sh --write   regenerate AGENTS.md from CLAUDE.md
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
source_md="$root/CLAUDE.md"
mirror_md="$root/AGENTS.md"

if [ ! -f "$source_md" ]; then
  echo "::error::check-agents-md.sh found no CLAUDE.md at $root. That is a gate that cannot read its input."
  exit 1
fi

mirror() { sed 's/CLAUDE\.md/AGENTS.md/g' "$source_md"; }

if [ "${1:-}" = "--write" ]; then
  mirror > "$mirror_md"
  echo "agents-md: wrote AGENTS.md from CLAUDE.md ($(wc -l < "$mirror_md" | tr -d ' ') lines)."
  exit 0
fi

if [ ! -f "$mirror_md" ]; then
  echo "::error::AGENTS.md is missing. Run ./scripts/check-agents-md.sh --write."
  exit 1
fi

if ! diff_out="$(diff -u --label 'CLAUDE.md (as AGENTS.md)' --label AGENTS.md <(mirror) "$mirror_md")"; then
  echo "::error::AGENTS.md differs from CLAUDE.md. Edit CLAUDE.md, then run ./scripts/check-agents-md.sh --write."
  printf '%s\n' "$diff_out" | head -60
  exit 1
fi

echo "agents-md: AGENTS.md mirrors CLAUDE.md."
