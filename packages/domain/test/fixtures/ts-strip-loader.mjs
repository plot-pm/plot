// A MINIMAL RESOLVER HOOK, registered only inside the stand-in's own process.
//
// Node's `--experimental-strip-types` runs `.ts` source directly but does not
// resolve the `.js`-suffixed specifiers this package's own source uses
// (`workflows/decision.js` importing an actual `decision.ts` file) — the TS
// convention of writing the specifier as it will resolve AFTER compilation.
// This hook falls back to the sibling `.ts` file whenever a `.js` specifier
// cannot be found, and only then: a real `.js` file still resolves first.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (err) {
          if (specifier.endsWith('.js')) {
            return next(specifier.slice(0, -3) + '.ts', context);
          }
          throw err;
        }
      }`,
    ),
  import.meta.url,
);
