# The job map: which CI jobs a `plot-local-checks.mjs --ci` answer selects.
#
# Input: the answer. `$changed` (`--rawfile`): the changed paths, one per
# line. Output: one object, each job's flag, `corpus_tests`,
# `contracts_tests` and `widened_by`. `ci.yml`'s `select` job reads it twice:
# for this run's selection, and for the reuse diff against an earlier run.
def under($p): . == $p or startswith($p + "/");
($changed | split("\n") | map(select(. != ""))) as $paths
| [.checks[] | select(.always | not) | .suite] as $suites
| ([.checks[] | select((.always | not) and .suite == "test/reconcile") | .tests[]] | unique) as $contracts
| ([.untested[] | select((endswith(".md") and (startswith("skills/") | not)) | not)]) as $wide
| ($wide | length > 0) as $all
| any($suites[]; under("packages/domain")) as $domain
| ($all or $domain or any($suites[]; under("packages/board"))) as $board
| ($all or $domain or any($suites[]; under("packages/fleet"))) as $fleet
| ($all or ($contracts | length > 0)) as $contract
| {
    corpus: ($all or .corpus or (.corpusTests | length > 0)),
    corpus_tests: (if $all or .corpus then "" else (.corpusTests | map(sub("^packages/domain/"; "")) | join(" ")) end),
    contracts: $contract,
    contracts_tests: (if $all then "" else ($contracts | join(" ")) end),
    board: $board,
    domain: ($all or $domain),
    fleet: $fleet,
    e2e: ($all or $contract or $board or $domain or $fleet),
    macos: ($all or any($paths[]; endswith(".sh")) or any($contracts[]; test("^test/reconcile/[^/]*gate[^/]*[.]test[.]mjs$"))),
    census: ($all or $board or $fleet or any($paths[]; under("skills/plot/scripts"))),
    widened_by: ($wide | join(" "))
  }
