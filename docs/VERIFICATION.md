# Verification record — 2026-10-23

Executed locally with Node 22 and Playwright Chromium in an isolated temporary profile.

- TypeScript strict checking: passed.
- Node unit/integration suite: 34 passed.
- Real-browser MV3 suite: 2 passed.
- esbuild unpacked extension build: passed.
- Dependency audit: 0 known vulnerabilities reported by npm at installation.
- Popup and archive screenshots inspected at 380px and 1400px widths.
- Independent read-only review found a protected-group rename/scan race and inaccurate popup Undo reporting. Both addressed; rename and interrupted-close regressions were observed failing before correction. Failed-Undo behavior is exercised in the browser suite.

Browser coverage includes English settings, a custom duration, native lastAccessed aging using a test-only clock offset, all-frame safety checks, preserving edited/pinned/grouped tabs, auto-close, archive search, selected restore, Restore all, Undo, browser restart persistence, recreated group protection, rename/color migration, worker stop and restart, failed Undo retention/reporting, and scanning beyond 2000 protected tabs.

Not an exhaustive guarantee of compatibility with every web app, OS notification UI, or Chrome release. Chrome 119–120 fallback is tested as pure policy/session behavior, not by launching those obsolete browser versions. Manual acceptance steps and platform limits are in TESTING.md and README.

## Closure 1.1.0 — 2026-10-24

User-supplied Closure design and all four original PNG icon sizes applied. Existing Chrome extension ID, local state schema, timers, group rules and archive engine preserved. Default installed settings and empty archive verified before and after updating the same permanent directory in Chrome.

- TypeScript strict checking and production build: passed.
- Full Node unit/integration suite: 38 passed, including calendar-day grouping, age display and one-minute copy.
- Real MV3 browser scenarios: 2 passed, including new duration pills, custom time, group chip protection, search, bulk restore, Undo and narrow-screen overflow.
- Independent read-only design-change review: no critical or important findings.
- Installed Chrome popup: Closure 1.1.0 name, original supplied icon, 24-hour preset, audio protection and existing archive count visibly verified.
