/**
 * The `PATH` stubs the census sandbox puts in front of the host CLIs.
 *
 * Each stub is a bash script that answers from fixture files and starts no
 * process: it parses its argv with builtins, prints the fixture with a `read`
 * loop, and appends its argv to `$CENSUS_STUB_LOG` with `printf`. So an
 * `execve` count holds the stub's own image, which stands in for the real CLI's
 * image, and nothing more.
 *
 * Fixture lookup, under `$CENSUS_FIXTURES/<cli>/`:
 *
 * - the key is the first two positional words, joined by `-`, with `/`
 *   replaced by `_` (`pr list` -> `pr-list`, `api graphql` -> `api-graphql`);
 * - `--state <s>` appends `-<s>`, `--head <b>` appends `-head-<b>`;
 * - `--jq`/`-q` reads `<key>.jq.txt` instead of `<key>.json`;
 * - `--include` prints an HTTP status line and a blank line before the body;
 * - `<file>.rc` holds an exit code; absent means 0;
 * - a missing file answers `[]`, except a `--head` query, which answers `[]`
 *   too: a head that has no fixture has no pull request.
 */

const STUB_HEADER = `#!/bin/bash
# Census stub: answers from fixture files, starts no process.
`;

/** Prints a fixture file with builtins only: no \`cat\`, no subshell. */
const EMIT = `emit() { # $1 = file
  local line
  while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < "$1"
}
`;

/**
 * `bb api <path>`: the key is `api-<last path segment>`, then `-<STATE>` from
 * a `state=` parameter or a `state="…"` filter and `-branch-<name>` from a `source.branch.name="…"`
 * filter, both read from the percent-encoded query. A missing file answers an
 * empty page envelope.
 */
const BB_API_KEY = `if [ "\${words[0]:-}" = api ]; then
  p="\${words[1]:-}"; base="\${p%%\\?*}"; base="\${base##*/}"; q=''
  case "$p" in *\\?*) q="\${p#*\\?}" ;; esac
  st=''; case "$q" in *state=*) st="\${q#*state=}"; st="\${st#%22}"; st="\${st%%%22*}"; st="\${st%%&*}"; st="\${st%%%20*}" ;; esac
  br=''; case "$q" in *source.branch.name=%22*) br="\${q#*source.branch.name=%22}"; br="\${br%%%22*}"; br="\${br//%2F/_}" ;; esac
  key="api-$base\${st:+-$st}\${br:+-branch-$br}"
  [ -f "$dir/$key.json" ] || [ -n "$jq" ] || { printf '{"values":[],"size":0,"pagelen":50}\\n'; exit 0; }
fi`;

/**
 * Builds the stub for a host CLI (`gh` or `bb`).
 *
 * @param cli - the CLI name; also the fixture subdirectory.
 * @returns the script text.
 */
export const hostCliStub = (cli: 'gh' | 'bb'): string => `${STUB_HEADER}${EMIT}
dir="\${CENSUS_FIXTURES:?}/${cli}"
[ -z "\${CENSUS_STUB_LOG:-}" ] || printf '${cli} %s\\n' "$*" >> "$CENSUS_STUB_LOG"
words=(); state=''; head=''; jq=''; include=0
while [ $# -gt 0 ]; do
  case "$1" in
    --state|-s) state="\${2:-}"; shift; [ $# -eq 0 ] || shift ;;
    --head) head="\${2:-}"; shift; [ $# -eq 0 ] || shift ;;
    --jq|-q) jq=1; shift; [ $# -eq 0 ] || shift ;;
    --include|-i) include=1; shift ;;
    -R|--repo|--json|--limit|-L|--search|-S|--branch|-b|-f|-F|-X|--method|--field|--raw-field|-H|--header|--template|-t|--workspace|--repository) shift; [ $# -eq 0 ] || shift ;;
    --*=*|-*) shift ;;
    *) [ "\${#words[@]}" -ge 2 ] || words+=("$1"); shift ;;
  esac
done
key="\${words[0]:-none}-\${words[1]:-none}"
key="\${key//\\//_}\${state:+-$state}\${head:+-head-\${head//\\//_}}"
${cli === 'bb' ? BB_API_KEY : ''}
file="$dir/$key\${jq:+.jq.txt}"
[ -n "$jq" ] || file="$file.json"
[ "$include" = 0 ] || printf 'HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'
if [ -f "$file" ]; then emit "$file"; else [ -n "$jq" ] || printf '[]\\n'; fi
rc=0
[ ! -f "$file.rc" ] || read -r rc < "$file.rc"
exit "$rc"
`;

/**
 * Builds the `curl` stub that answers a Jira tracker's REST calls.
 *
 * `plot-host.sh` reaches Jira with `curl -sS --user … -w '\\n%{http_code}'
 * <base><path>` and no CLI of its own, so the tracker stub shadows `curl`. The
 * key is the URL path after the host, query stripped, `/` replaced by `_`; a
 * missing file answers an empty search page. Every answer ends with the
 * status line `-w` would print.
 *
 * @returns the script text.
 */
export const jiraCurlStub = (): string => `${STUB_HEADER}${EMIT}
dir="\${CENSUS_FIXTURES:?}/jira"
[ -z "\${CENSUS_STUB_LOG:-}" ] || printf 'curl %s\\n' "$*" >> "$CENSUS_STUB_LOG"
url=''
for arg in "$@"; do case "$arg" in http://*|https://*) url="$arg" ;; esac; done
path="\${url#*://}"; path="/\${path#*/}"; path="\${path%%\\?*}"
file="$dir/\${path//\\//_}.json"
if [ -f "$file" ]; then emit "$file"; else printf '{"issues":[],"isLast":true,"total":0}\\n'; fi
printf '200'
`;
