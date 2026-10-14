// `commission.ts`: THE REMOVAL — replaces `commission-route.test.ts`.
//
// The fleet now writes a Design plan's spec automatically (the spec run,
// #1680), so the board's *Commission design* button is redundant: `needs-design`
// does the state transition and the fleet's auto-design pass does the writing.
// `packages/board/src/server/commission.ts` is deleted, and this asserts the
// three things that must be true of its absence rather than of any replacement
// behaviour — nothing here spawns an agent or writes a prompt file, because
// there is no handler left to do either.
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { startServer, fetchBoard, fetchRaw, request, makeRepo, rmTree } from '../helpers.mjs';

const DRAFT = `# A draft plan

## Status

- **Phase:** Draft
- **Type:** feature

## Changelog

- a draft with no commission route to call
`;

describe('POST /api/commission and GET /api/commission/<slug> are gone', () => {
  let repo: string;
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    repo = makeRepo({ plans: [{ name: '2026-08-20-a-draft-plan.md', content: DRAFT }] });
    server = await startServer(repo);
  });
  afterAll(() => {
    server?.kill();
    rmTree(repo);
  });

  it('answers POST /api/commission with 405, the router\'s blanket non-GET refusal', async () => {
    // Not 404: `/api/commission` matches no entry in WRITE_ROUTES, so a POST
    // falls through to the same blanket `405 Method Not Allowed` every
    // non-GET request against an unlisted path gets (`index.ts`). The plan's
    // acceptance text says "404" for both verbs; this is the one the removal
    // actually produces, and it is reported rather than special-cased — the
    // task is deleting the route, not inventing router behaviour for it.
    const got = await request(server.port, { method: 'POST', path: '/api/commission', body: '{}' });
    expect(got.status).toBe(405);
  });

  it('answers GET /api/commission/<slug> with 404, the router\'s fall-through', async () => {
    const got = await fetchRaw(server.port, '/api/commission/a-draft-plan');
    expect(got.status).toBe(404);
  });

  it('carries no commission capability on the board payload', async () => {
    const board = await fetchBoard(server.port);
    const cards = board.columns.flatMap((c: any) => c.cards);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card).not.toHaveProperty('commission');
      expect(card.controls ?? {}).not.toHaveProperty('commission');
    }
  });
});
