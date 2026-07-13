// Public entry for `@plot-pm/board/contract` — the zod schemas and types that
// describe the board's data contract. Kept dependency-light (zod only) so a
// future consumer (e.g. a public read-only viewer) can reuse the types without
// pulling in the server or the React app.
export * from './schema.js';
