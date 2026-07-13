/// <reference types="vite/client" />

// The built client is inlined into the server bundle as a text string by
// esbuild's `text` loader (see build.mjs). The wildcard module keeps `tsc`
// happy without the dist/ artifact needing to exist at typecheck time.
declare module '*.html' {
  const html: string;
  export default html;
}
