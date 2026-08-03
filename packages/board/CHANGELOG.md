# @plot-pm/board

## 0.3.0

### Minor Changes

- [`f65e506`](https://github.com/plot-pm/plot/commit/f65e506c5ee16cdcc7e7a4efd9b8cd62c0de97d8) Thanks [@eins78](https://github.com/eins78)! - The Approved column splits into **Ready** (approved, no `Started:` record) vs **In progress** (has one) — Approved cards carry a `started` flag and render the matching badge. The plan-meta ceremony fields (`review`, `impl`, `approved_raw`, `started_raw`) enter the board's zod contract, and the story status vocabulary widens (`ready`, `in-review`).

## 0.2.1

### Patch Changes

- [#44](https://github.com/plot-pm/plot/pull/44) [`cee4d94`](https://github.com/plot-pm/plot/commit/cee4d94efbac12d56f5ed53aab250ce838580ba3) Thanks [@eins78](https://github.com/eins78)! - `@plot-pm/board` is now a self-contained npm package. It vendors Plot's plan-parser scripts (`plot-config.sh`, `plot-plan-meta.sh`) into the published tarball and bundles `zod`, so it declares zero runtime dependencies. You can now install and run the board with `npx @plot-pm/board` or `pnpm dlx @plot-pm/board` in any repository — including one pointed at a private or authenticated registry — instead of only from a Plot checkout.
