import { describe, expect, it } from 'vitest';

import { run } from '../../src/server/entry/slice-claims.js';

describe('plot-slice-claims', () => {
  it('prints one reference-tab-branch row per claimed PR, and `-` for a branch naming none', () => {
    let out = '';
    const code = run(
      [
        '## Slices',
        '',
        '- `feature/a` — local → #12',
        '- `infra/shared` — one → quatico/one#11',
        '- `infra/shared` — two → quatico/two#22',
        '- `feature/bare` — no annotation',
      ].join('\n'),
      (s) => {
        out += s;
      },
    );

    expect(code).toBe(0);
    expect(out).toBe('#12\tfeature/a\nquatico/one#11\tinfra/shared\nquatico/two#22\tinfra/shared\n-\tfeature/bare\n');
  });

  it('prints nothing for a plan with no slice section', () => {
    let out = '';
    run('# A plan\n\n## Notes\n\n- `feature/x` → #1\n', (s) => {
      out += s;
    });
    expect(out).toBe('');
  });
});
