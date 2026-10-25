// Regression test for .changeset/changelog-functions.js — the local wrapper
// that keeps a backtick-quoted issue reference (`` `#2065` ``) literal where
// the stock @changesets/changelog-github would turn it into a markdown link.
//
// RUN AGAINST THE REAL MODULE, not a copy of its logic, the same reason
// same-commit.corpus.test.ts was rewritten to call plot-host.sh directly: a
// pasted-in regex can drift from the file it was copied from without anything
// noticing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const { default: changelogFunctions } = await import(path.join(repoRoot, '.changeset', 'changelog-functions.js'));

test('a backtick-quoted issue reference stays literal text', async () => {
  const line = await changelogFunctions.getReleaseLine(
    { summary: 'Fix a bug referenced in `#2065`.', commit: undefined },
    'patch',
    { repo: 'plot-pm/plot' },
  );
  assert.match(line, /`#2065`/);
  assert.doesNotMatch(line, /\[#2065\]/);
});

test('a bare issue reference outside backticks is still linkified', async () => {
  const line = await changelogFunctions.getReleaseLine(
    { summary: 'Fix a bug referenced in #2065.', commit: undefined },
    'patch',
    { repo: 'plot-pm/plot' },
  );
  assert.match(line, /\[#2065\]\(https:\/\/github\.com\/plot-pm\/plot\/issues\/2065\)/);
});

test('an issue reference already inside a markdown link is left alone', async () => {
  const line = await changelogFunctions.getReleaseLine(
    { summary: 'See [#2065](https://github.com/plot-pm/plot/issues/2065) for context.', commit: undefined },
    'patch',
    { repo: 'plot-pm/plot' },
  );
  assert.match(line, /\[#2065\]\(https:\/\/github\.com\/plot-pm\/plot\/issues\/2065\) for context/);
});

test('getDependencyReleaseLine still produces the stock bullet list', async () => {
  const line = await changelogFunctions.getDependencyReleaseLine(
    [],
    [{ name: 'some-pkg', newVersion: '1.2.3' }],
    { repo: 'plot-pm/plot' },
  );
  assert.match(line, /some-pkg@1\.2\.3/);
});
