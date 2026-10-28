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

## Permanent-directory installer — 2026-10-24

Added the standalone Python 3.10+ installer, ZIP and built-source inputs, OS-specific Chrome directory selection, legacy-path preservation, code backups, rollback, path validation and dry-run mode. Browser preferences, registration and archive data are outside the installer’s write scope.

- Full Node extension suite: 38 passed.
- Installer filesystem / CLI suite: 14 passed, entirely in temporary directories.
- Strict TypeScript checking, production build and formatting checks: passed.
- Read-only real-package dry-run selected the existing `Unpacked Extensions/Quiet Archive` directory; no installed Chrome files changed.
- Independent review found a case-insensitive profile-path bypass; a regression test reproduced it, then passed after case/Unicode-normalized boundary checks.

## Sleeping tabs and background recovery — 2026-10-28 (1.2.0)

A local diagnostic export from the user's installed 1.1.0 showed 25 unavailable/sleeping tabs skipped, 2 unsaved/unverifiable, 13 recent, and protected groups/pinned tabs. The selected 12-hour timer was running; strict safety prevented old discarded pages from being archived. Chrome also reported a transient No current window error.

- Explicit opt-in Archive unverifiable tabs defaults off, preserving existing profile behavior. The user approved enabling it for their installation; URL-only/draft-loss limitations are visible in the popup and README.
- Strict TypeScript, production build, full Node suite (45 tests), installer suite (14 tests), formatting and whitespace checks passed.
- Three real MV3 browser scenarios passed, including native tabs.discard, strict-mode retention, opt-in close and Undo, preserved pinned/groups, and unsafe latches surviving discard plus service worker stop.
- Startup/current-window failure and recovery regressions were observed failing before fixes. Successful manual checks now clear the stale toolbar error immediately.
- Independent code review found no blocking defects and noted the stale manual-scan toolbar issue; a failing regression demonstrated it and the shared scan path fixed it.
- Browser fixtures use actual Chrome tab existence rather than Playwright Page.isClosed for discarded pages: renderer destruction is not tab closure.

Installed into the same permanent Chrome directory and reloaded in both real profiles, retaining extension ID and their existing 12-hour settings/group rules. Manual checks visibly archived 22 tabs in Wabi and 6 in Personal, with Undo available; Wabi (pink) and Personal (orange) stayed checked as protected. No page reloads were forced.

## Unload policy compatibility — 2026-10-28 (1.2.1)

The user's Chrome error panel showed policy violations attributed to the guard while a website attempted to register a forbidden unload handler. A real browser fixture with `Permissions-Policy: unload=()` reproduced the exact warning through CDP Log before the fix; the regression passes after it.

- A self-contained compatibility wrapper skips only window unload registration explicitly forbidden by the document policy. Allowed or unknown policy and unrelated events retain native forwarding. Browser policy is not relaxed and console reporting is not suppressed.
- Existing live HTTP(S) pages receive this compatibility patch on installation/update without reload or installation/reset of their safety probe. Restricted, incognito, discarded and frozen pages are left alone; later document loads receive the updated guard normally.
- Full Node suite: 48 passed. Installer suite: 14 passed. Real MV3 browser suite: 4 passed. Strict TypeScript, build, formatting and diff checks passed.
- Upgrade/idempotence tests preserve an existing unsafe probe, leave missing probes absent, retain beforeunload forwarding and avoid wrapper stacking. A background lifecycle test covers update injection/filtering.
- Independent review found no important defect; a separate serialized-function check confirmed compatibility in a fresh realm.
- Installed 1.2.1 and visibly verified its version in both real Chrome profiles. Historical error entries are retained by Chrome; updating the extension does not erase that journal.
