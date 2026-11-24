// `POST /api/release-finish` validates its request, runs the version entry in
// process, and answers the outcome or the refusal's reason.
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';
import { answered } from '@plot-pm/domain';
import { handleReleaseFinish, releaseFinishStatus } from '../../src/server/release-finish-route.js';
import type { FinishContext } from '../../src/server/entry/release-finish.js';

const post = async (
  payload: unknown,
  context: FinishContext,
  headers: http.IncomingHttpHeaders = {},
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const req = Readable.from([JSON.stringify(payload)]) as unknown as http.IncomingMessage;
  req.headers = headers;
  req.method = 'POST';
  let status = 0;
  let text = '';
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      return this;
    },
    end(chunk?: string) {
      text = chunk ?? '';
      return this;
    },
  } as unknown as http.ServerResponse;
  await handleReleaseFinish(req, res, { repoRoot: '/nowhere', host: 'localhost', port: 7777, context, env: {} });
  return { status, body: JSON.parse(text) as Record<string, unknown> };
};

/** A context whose default-branch fetch fails, and that counts the fetches it is asked for. */
const unfetchable = () => {
  const fetches: string[] = [];
  const context = {
    repoRoot: '/nowhere',
    refs: { defaultBranch: async () => answered('main') },
    trees: {
      fetch: async (_root: string, ref: string) => {
        fetches.push(ref);
        return { ok: false, reason: 'unaskable', detail: 'no origin' };
      },
    },
  } as unknown as FinishContext;
  return { context, fetches };
};

describe('POST /api/release-finish', () => {
  it('answers 400 and fetches nothing for a body without an N.N.N version', async () => {
    const { context, fetches } = unfetchable();
    const answer = await post({ version: '2.36' }, context);
    expect(answer.status).toBe(400);
    expect(fetches).toEqual([]);
  });

  it('answers 403 and fetches nothing for a cross-origin request', async () => {
    const { context, fetches } = unfetchable();
    const answer = await post({ version: '2.36.0' }, context, { origin: 'http://evil.example' });
    expect(answer.status).toBe(403);
    expect(fetches).toEqual([]);
  });

  it("answers the refusal's reason and its status where the finish refuses", async () => {
    const { context, fetches } = unfetchable();
    const answer = await post({ version: '2.36.0' }, context);
    expect(answer.status).toBe(500);
    expect(answer.body).toMatchObject({ version: '2.36.0', reason: 'default-branch-unfetched' });
    expect(fetches).toEqual(['main']);
  });

  it.each([
    ['unattended', 403],
    ['default-branch-unfetched', 500],
    ['push-rejected', 500],
    ['tag-absent', 409],
    ['sprint-ambiguous', 409],
    ['plan-unbookable', 409],
  ])('maps %s to %i', (reason, status) => expect(releaseFinishStatus(reason)).toBe(status));
});
