// NO TEST RESOLVES A REAL TOKEN. fleetd and `plot-pr-reader.mjs` read GitHub
// in-process wherever a token resolves, and `gh auth token` would hand them the
// operator's. Every fleet unit test, and every bundle it starts, reads through
// the shell unless it composes its own reads; a test of the in-process route
// passes `hostReads` or a client of its own.
process.env['PLOT_HOST_TRANSPORT'] ??= 'shell';
