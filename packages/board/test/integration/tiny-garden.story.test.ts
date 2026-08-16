import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Data layer: spawn the built artifact and hit GET /story/<slug> directly, so
// the resolver both viewer routes share is exercised on exactly what plot ships
// (real server, real allowlist).
import { startServer, fetchRaw, fetchBoard } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const STORY = '/story/berry-patch';

describe('tiny-garden: story viewer (built artifact renders /story/<slug>)', () => {
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    server = await startServer(FIXTURE);
  });
  afterAll(() => server?.kill());

  it('renders the story markdown to HTML, with the same CSP the plan route sets', async () => {
    const { status, headers, body } = await fetchRaw(server.port, STORY);
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    // Same shell, same rules: `marked` does not sanitize raw HTML, so the CSP
    // neuters any <script> a story might carry on the un-sandboxed full page.
    expect(headers['content-security-policy']).toContain("script-src 'none'");
    expect(body).toContain('<h1>Berry patch</h1>');
    // Front matter is stripped, exactly as for a plan.
    expect(body).not.toContain('status: active');
  });

  it('shows a back-to-board titlebar, and omits it when embedded', async () => {
    const full = await fetchRaw(server.port, STORY);
    expect(full.body).toContain('<header class="plan-titlebar">');
    const embedded = await fetchRaw(server.port, `${STORY}?embed=1`);
    expect(embedded.status).toBe(200);
    expect(embedded.body).not.toContain('<header class="plan-titlebar">');
    expect(embedded.body).toContain('<h1>Berry patch</h1>');
  });

  it('carries the story path on the board contract, repo-relative', async () => {
    // The consumer must not reconstruct it: a slug is a directory name AND part
    // of the filename, so rebuilding it client-side encodes that convention
    // twice and lets the copies drift.
    const board = await fetchBoard(server.port);
    const berry = board.stories.find((s: any) => s.slug === 'berry-patch');
    expect(berry.path).toBe('docs/stories/berry-patch/STORY-berry-patch.md');
  });

  // ── The negatives. Same shape as /plan/'s, because it is the same resolver ──

  it('404s a slug that names no collected story', async () => {
    const { status } = await fetchRaw(server.port, '/story/no-such-story');
    expect(status).toBe(404);
  });

  it('404s a path-traversal attempt', async () => {
    // The slug is never joined into a path — it is matched against the stories
    // the board walked — so `..` simply matches nothing.
    expect((await fetchRaw(server.port, '/story/../../CLAUDE.md')).status).toBe(404);
  });

  it('404s an ENCODED path-traversal attempt', async () => {
    // %2F survives URL parsing, so the handler decodes "../../CLAUDE.md"; the
    // allowlist rejects it before any file is touched.
    expect((await fetchRaw(server.port, '/story/..%2F..%2FCLAUDE.md')).status).toBe(404);
    // And the two-position variant, which is what makes a story slug different
    // from a plan basename: it lands in a directory name as well as a filename.
    expect((await fetchRaw(server.port, '/story/..%2Farchived%2Fberry-patch')).status).toBe(404);
  });

  it('404s a story file addressed by name rather than by slug', async () => {
    // A reader (or a bad client) naming the file directly must not resolve —
    // the route's vocabulary is slugs, and widening it would widen the surface.
    expect((await fetchRaw(server.port, '/story/STORY-berry-patch.md')).status).toBe(404);
  });

  it('400s a malformed percent-escape instead of crashing the server', async () => {
    // THE reason both routes share one resolver. decodeURIComponent throws
    // URIError on an incomplete escape; an uncaught throw in the request
    // listener would take this single-process server down, so one malformed URL
    // would kill the board. It must be a 400, and the server must survive it.
    const { status } = await fetchRaw(server.port, '/story/%E0%A4%A');
    expect(status).toBe(400);
    // Still alive: a normal request right after still works.
    expect((await fetchRaw(server.port, STORY)).status).toBe(200);
  });

  it('survives a malformed escape on the plan route too, from the same code path', async () => {
    // Asserted as a PAIR rather than in two suites: the claim is that the two
    // routes cannot diverge, and a test that checks each alone would still pass
    // the day someone forked the handler.
    expect((await fetchRaw(server.port, '/plan/%E0%A4%A')).status).toBe(400);
    expect((await fetchRaw(server.port, '/story/%E0%A4%A')).status).toBe(400);
    expect((await fetchRaw(server.port, STORY)).status).toBe(200);
  });
});
