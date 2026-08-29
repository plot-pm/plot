import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Data layer: spawn the built artifact and hit GET /plan/<file> directly, so
// the markdown→HTML render and the path-traversal guard are exercised on
// exactly what plot ships (real server, real allowlist).
import { startServer, fetchRaw } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const PLAN = '/plan/2026-03-01-plant-tomatoes.md';

describe('tiny-garden: plan viewer (built artifact renders /plan/<file>)', () => {
  let server: { port: number; kill: () => void };

  beforeAll(async () => {
    server = await startServer(FIXTURE);
  });
  afterAll(() => server?.kill());

  it('renders the plan markdown to HTML (headings, lists, links, code)', async () => {
    const { status, headers, body } = await fetchRaw(server.port, PLAN);
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    // marked does not sanitize raw HTML; the CSP neuters any <script>/inline
    // handler a plan might carry on the un-sandboxed full-page view.
    expect(headers['content-security-policy']).toContain("script-src 'none'");
    // Real conversion, not "contains some text": each markdown construct in the
    // enriched fixture plan comes back as its HTML element.
    expect(body).toContain('<h1>Plant heirloom tomatoes</h1>');
    expect(body).toContain('<h2>Approach</h2>');
    expect(body).toContain('<li>Brandywine</li>');
    // A story link arrives REWRITTEN to its board route, and the relative path
    // it was written as is gone. Both halves are needed: the route alone would
    // also pass on a renderer that emitted it for every link, and the absence
    // alone would pass on one that dropped the link entirely. Together they
    // only hold if `rewritePlanLinks` ran on this specific href.
    //
    // The relative form is what the plan file on disk carries, and it is BROKEN
    // in a browser at `/plan/<file>` — it resolves against the route rather
    // than the docs tree. This assertion read the raw path until 2026-08-29,
    // when the rewrite landed (d23c03a0) and turned it into an assertion that
    // the bug was still there.
    expect(body).toContain('href="/story/raised-beds"');
    expect(body).not.toContain('../stories/raised-beds/STORY-raised-beds.md');
    expect(body).toMatch(/<pre>[\s\S]*20 minutes[\s\S]*<\/pre>/);
  });

  it('shows a back-to-board titlebar on the full-page view', async () => {
    const { body } = await fetchRaw(server.port, PLAN);
    // The titlebar element (not just the CSS rule, which is always present).
    expect(body).toContain('<header class="plan-titlebar">');
    // A working link back to the board root.
    expect(body).toMatch(/<a[^>]*class="plan-back"[^>]*href="\/"/);
    expect(body).toContain('Board');
  });

  it('omits the titlebar when embedded (?embed=1)', async () => {
    const { status, body } = await fetchRaw(server.port, `${PLAN}?embed=1`);
    expect(status).toBe(200);
    // The element is gone (the shared CSS rule stays); no back link either.
    expect(body).not.toContain('<header class="plan-titlebar">');
    expect(body).not.toContain('class="plan-back"');
    // …but still renders the plan itself.
    expect(body).toContain('<h1>Plant heirloom tomatoes</h1>');
  });

  it('strips YAML front matter before rendering', async () => {
    // zucchini-glut leads with a --- front-matter block; it must not appear.
    const { status, body } = await fetchRaw(server.port, '/plan/2026-05-15-zucchini-glut.md');
    expect(status).toBe(200);
    expect(body).toContain('<h1>Deal with the zucchini glut</h1>');
    expect(body).not.toContain('assignee: mgardener');
  });

  it('404s a file that exists under the repo but is not a board plan', async () => {
    // CLAUDE.md is real and readable in the fixture root — a naive "read any
    // file under repoRoot" would serve it. The allowlist rejects it.
    const { status } = await fetchRaw(server.port, '/plan/CLAUDE.md');
    expect(status).toBe(404);
  });

  it('404s an encoded path-traversal attempt', async () => {
    // %2F survives URL parsing, so the handler decodes "../../CLAUDE.md" and the
    // basename guard rejects it before any file is touched.
    const { status } = await fetchRaw(server.port, '/plan/..%2F..%2FCLAUDE.md');
    expect(status).toBe(404);
  });

  it('404s a plan name that does not exist', async () => {
    const { status } = await fetchRaw(server.port, '/plan/2099-01-01-nope.md');
    expect(status).toBe(404);
  });

  it('400s a malformed percent-escape instead of crashing the server', async () => {
    // decodeURIComponent throws URIError on an incomplete escape. If that throw
    // escaped the request listener it would crash the single-process server
    // (DoS); the handler must turn it into a 400 and keep serving.
    const { status } = await fetchRaw(server.port, '/plan/%E0%A4%A');
    expect(status).toBe(400);
    // Server is still alive: a normal request right after still works.
    const after = await fetchRaw(server.port, PLAN);
    expect(after.status).toBe(200);
  });
});
