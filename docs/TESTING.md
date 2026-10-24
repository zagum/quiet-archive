# Verification

Automated commands and scope are in README. The browser test uses a new temporary profile and closes it on completion.

## Manual acceptance in Developer Mode

1. Load `dist/` in a fresh Chrome profile. Open popup: English labels, default 24h, audio protected, ungrouped eligible, archive empty.
2. Create two ordinary groups with different title/color signatures. Check one. Reopen popup and ensure its rule persists. Close and recreate that group: protection applies. Duplicate its title/color in another window: both must be protected. Rename/recolor the protected live group: its new signature must remain protected.
3. Configure Custom = 1 minute. Open several ordinary web pages, visit one in each normal window, pin another, edit a form on another, start audio on another, and leave others inactive. Ensure safety guards were present when documents loaded. After a minute plus the next scheduled check, only eligible untouched pages should disappear.
4. Edit an input inside an iframe or add a beforeunload handler: the whole tab must remain. Restricted pages, pages loaded before extension install, discarded tabs and blocked site access must be skipped.
5. In archive, search title, URL and group. Select visible entries, then restore selected. Unselected entries stay. Restore one, then restore all. Successful restores remove entries; grouped entries regain ordinary group names/colors. Verify no source window ID is reused after a browser restart.
6. Archive a batch and click Undo from popup, archive or notification. Optional OS notifications may hide buttons; popup must still offer Undo. Restore failures must be retained and reported.
7. Stop the worker in chrome://serviceworker-internals (or wait for normal suspension), then use popup or wait for alarm. Reopen Chrome: settings/archive/protection persist and alarm exists. With Chrome <121 fallback times conservatively restart after browser restart.
8. Create an archive, close its source window, restore from another window; restoration must still work. Opening archive itself creates an ordinary extension tab and keeps an eligible destination available.
9. Disable auto archive: Check tabs now should leave tabs alone. Re-enable and repeat. Create another Chrome profile: settings and archive must be independent.
10. Inspect Network in extension DevTools: no requests to an extension backend. Inspect storage: form contents are absent. Export a backup, confirm JSON includes settings/archive and no form text.

Known limits: not every SPA/canvas editor exposes unsaved state; Chrome API check/remove is not atomic; exact-once tab creation after a crash is impossible. These are described in README, not asserted as solved by tests.
