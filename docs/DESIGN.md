# Quiet Archive design

A local-only Chrome Manifest V3 extension with an English popup and searchable archive. Source TypeScript is bundled with esbuild; UI uses semantic HTML and CSS, no remote code or backend.

## Decisions

A persistent background page conflicts with MV3; timers alone do not survive worker suspension. Use alarms and register listeners synchronously. Chrome 111+ is the baseline (MAIN-world document-start guards); use tabs.lastAccessed on Chrome 121+, otherwise keep session-local activity timestamps. Do not reuse tab IDs after restart. Unknown activity starts at first observation.

Protect active tabs in every window, pinned, highlighted, incognito, non-HTTP(S), loading, discarded/frozen and pending-navigation tabs. Audio protection is enabled by default. Include ungrouped tabs by default, with a protection toggle.

Group IDs are ephemeral. A user-selected protection rule matches title + color, including recreated groups. Same-name/color collisions are all protected. Track renames/color changes of protected live groups during a session. Keep rules when a group/window disappears. Never infer protection from Saved Tab Groups, collapsed or shared flags.

Before closing, query all frames and require a document-start safety guard in every frame. The guard records input/change/contenteditable editing and beforeunload registration conservatively until navigation. Probe failure or unknown coverage means skip. No general extension API can identify all unsaved app state, and no atomic check-and-remove API exists; document both limits honestly. Do not bypass native dialogs.

Serialize mutations through the worker. Persist an archive entry with pending status before tabs.remove. Confirm absence before marking closed. Recover pending entries after worker termination: a live source tab retains an uncertain recovery entry (the native close may still finish); an absent tab finalizes it. If browser session changed, preserve an uncertain recovery entry instead of applying old IDs. Persist restore intents before creating tabs, then persist returned IDs; uncertain interrupted restores remain archived and are never retried automatically. Archive stores URLs/titles/group metadata, not form data or browser history.

Restore individual, selected, or all entries into an available normal window, falling back to a new window if none exists. Restore grouped entries together into new ordinary groups; never reuse stale window/group IDs across sessions. Successful restores leave the archive. Keep failures for retry. Undo restores the latest automatic batch from popup, archive, or optional notification. No automatic archive pruning.

## Alternatives

Sessions API alone has bounded browser-managed history and cannot provide an independent durable archive. A framework is unnecessary for two small screens. Raw group IDs cannot support browser restart. Prefer conservative false positives to closing an uncertain page.

## Closure visual update — 2026-10-24

User-provided closure.zip supplies the Closure name, blue icon assets, light gray background, white cards, duration pills, protected-group chips and archive day sections. The archive’s reference implementation is visual material only: the tested TypeScript engine, local state schema, unsaved-edit guard, durable group rules, Undo, bulk restoration and unlimited retention remain unchanged. Original icon PNGs are used at 16, 32, 48 and 128 pixels. No external font or favicon requests. Existing internal alarm/storage identifiers and installed extension directory remain stable across the 1.1.0 update.

Duration choices retain 24 hours, 7 days, 30 days and custom time; quick 1/4/12-hour presets match the reference’s pill layout. Custom inputs retain accessible labels and keyboard focus. Group chips retain native accessible checkboxes, and closed groups keep their durable rules. Archive day labels use local calendar boundaries rather than fixed 24-hour arithmetic.
