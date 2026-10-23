# Quiet Archive Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Check each task against tests before completion.

**Goal:** Build and publish a private repository for a local MV3 tab archive.
**Architecture:** Pure policy and validation, serialized engine with injected browser/storage adapter, Chrome worker, document safety guard, popup and archive UI.
**Tech Stack:** TypeScript, esbuild, Node test runner, Playwright.
**Spec:** ../../DESIGN.md

## Global Constraints

- English interface; local storage per Chrome profile; no server.
- Never intentionally close active or pinned tabs; skip safety uncertainty.
- Store archive before removal; never prune automatically.

## Review Focus

- Active/pinned/audio/group changes between scan and removal: recheck.
- Worker stopped during close or restore: journal and recovery.
- Browser restart recycles IDs: session token checks.
- Storage/remove/create failures: retain recoverable archive.
- Form and iframe edits: safety guard and all-frame coverage.

### Task 1: Policy and validation

Files: src/model.ts, src/policy.ts, tests/policy.test.ts.

- [x] Write tests for eligibility, boundary time, fallback age, group rules, invalid settings and safe URLs; run RED.
- [x] Implement types and pure policy; run GREEN.

### Task 2: Durable engine

Files: src/engine.ts, tests/engine.test.ts.
Consumes policy; produces Engine.scan(), recover(), restore(ids), updateSettings().

- [x] Write stateful browser-adapter tests for journal ordering, cancellation, restart recovery, partial restore and failed persistence; run RED.
- [x] Implement serial durable close/restore; run GREEN.

### Task 3: Chrome integration and UI

Files: src/background.ts, src/guard.ts, src/popup.ts, src/archive.ts, src/ui.ts, public/*, scripts/build.mjs.

- [x] Add guard tests for editing/beforeunload and browser smoke tests; run RED.
- [x] Implement adapter, alarms, listeners, runtime requests, safety guard, accessible English UI; run checks.

### Task 4: Delivery

Files: README.md, docs/*, .github/workflows/check.yml.

- [x] Add installation, permissions/privacy, edge cases, manual verification and CI.
- [x] Run typecheck, full tests, build, browser tests and fresh code review.
- [x] Create private zagum/quiet-archive repository, push source and package installable ZIP.
