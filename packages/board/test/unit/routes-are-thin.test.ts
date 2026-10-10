import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// `/api/dispatch` and `/api/continue` keep the HTTP half only. The decisions —
// which refusal, which receipt, which agent — live in `@plot-pm/fleet`, so a
// route that grows them back shows here as an import it must not hold.

const SERVER = path.resolve(__dirname, '../../src/server');
/** A file's source with block and line comments removed, so prose naming a function is not a use of it. */
const read = (name: string): string =>
  fs
    .readFileSync(path.join(SERVER, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The module specifiers of a file's `import … from '…'` statements. */
const importsOf = (source: string): string[] =>
  [...source.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);

describe('the routes are thin', () => {
  it('dispatch.ts calls startDispatch and reads no Implement command itself', () => {
    const source = read('dispatch.ts');
    const imports = importsOf(source);
    assert.ok(imports.includes('@plot-pm/fleet/shared/dispatch-command'));
    assert.ok(!imports.includes('@plot-pm/fleet/shared/action-receipt'), 'the receipt is the fleet module’s');
    assert.ok(!imports.includes('@plot-pm/fleet/shared/usable-command'), 'the command check is the fleet module’s');
    assert.doesNotMatch(source, /recordActionReceipt|IMPLEMENT_COMMAND_KEY|usableCommand/);
  });

  it('continue.ts calls continueBranch and not continueOnDesk', () => {
    const source = read('continue.ts');
    const imports = importsOf(source);
    assert.ok(imports.includes('@plot-pm/fleet/shared/continue-command'));
    assert.doesNotMatch(source, /continueOnDesk|branchFromPulse/);
  });
});
