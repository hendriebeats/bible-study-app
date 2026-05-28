# E2E tests (Playwright)

Editor regression suite that lives in the repo and runs in CI. Tests target
the local Next.js dev server (started automatically by Playwright via
`webServer` in `playwright.config.ts`).

## Run

```bash
npm run test:e2e            # headless chromium
npm run test:e2e:ui         # interactive UI mode (best DX)
npm run test:e2e:debug      # headed, paused at start
npx playwright show-report  # open the last HTML report
```

The first run installs the chromium browser binary (one-time, ~150MB).

## Conventions

- **Test users** live in `e2e/fixtures/auth.ts`. `test1` is regular; `test2` is
  a permanent admin. Use `test2` only when admin power is required.
- **Editor introspection** uses `window.__PM_DEBUG__.getDocJSON()`. The hook is
  installed by the editor host when `NEXT_PUBLIC_PM_DEBUG=1`. Playwright sets
  this automatically via `playwright.config.ts` → `webServer.env`.
- **No structural shape assumptions hard-coded.** Use `expectDocEventually`
  with a matcher function so the same test passes through schema migrations
  (e.g. the flat-schema rewrite); the matcher should describe the user-visible
  invariant, not the doc JSON shape.
- **Use `keyboard.type()` not `fill()`** — controlled React inputs sometimes
  ignore programmatic `fill` values. See
  `~/.claude/memory/playwright-testing-notes.md` for the history on this.
- **Editor tests are not fully parallel.** `playwright.config.ts` sets
  `fullyParallel: false` because two simultaneous workers stepping on the same
  dev server's HMR causes flake. Specs in different files still run in
  parallel; we just don't run tests within a file concurrently.

## Layout

```
e2e/
├── README.md             # this file
├── smoke.spec.ts         # login + studies index
├── fixtures/
│   ├── auth.ts           # signIn + TEST_USERS
│   └── editor.ts         # editor locator + readDocJSON helper
└── editor/               # editor regression suite (one file per surface)
    ├── markdown-shortcuts.spec.ts
    ├── tab-indent.spec.ts
    ├── backspace.spec.ts
    └── …
```

## Adding a new spec

1. Drop it in `e2e/editor/<surface>.spec.ts`.
2. Import `signIn` + `focusEditor` + `readDocJSON` from the fixtures.
3. Drive the editor with `keyboard.press` / `keyboard.type`.
4. Assert behavior with `expectDocEventually` (poll-and-match) rather than a
   synchronous `expect`, so tx scheduling doesn't flake the test.
