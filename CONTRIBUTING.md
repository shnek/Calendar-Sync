# Contributing

Thanks for helping! A few notes:

- `npm install`, then `npm run dev` for the app, or `npm test` for the engine.
- Keep `src/core` free of Electron imports. It's shared by the app, the CLI and the tests.
- Calendar parsing bugs: add a minimal `.ics` fixture under `test/fixtures` that reproduces the problem. Strip names, emails and links first.
- Before opening a PR, make sure `npm run lint && npm run typecheck && npm test` pass.
- Never commit real feed URLs, OAuth client secrets or `calendar-sync.config.json`.
