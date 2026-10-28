import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eligible,
  activityTime,
  groupKey,
  validateSettings,
  safeUrl,
} from "../src/policy.js";
import { defaults, type Tab } from "../src/model.js";
const now = 2_000_000_000;
const tab: Tab = {
  id: 1,
  windowId: 1,
  index: 0,
  url: "https://example.com",
  title: "Example",
  active: false,
  pinned: false,
  groupId: -1,
  lastAccessed: now - 86_400_000,
  status: "complete",
};
test("closes at threshold, but not one millisecond earlier", () => {
  assert.equal(eligible(tab, defaults, undefined, undefined, now).ok, true);
  assert.equal(
    eligible(
      { ...tab, lastAccessed: now - 86_400_000 + 1 },
      defaults,
      undefined,
      undefined,
      now,
    ).ok,
    false,
  );
});
for (const [label, patch] of Object.entries({
  active: { active: true },
  pinned: { pinned: true },
  highlighted: { highlighted: true },
  audio: { audible: true },
  incognito: { incognito: true },
  loading: { status: "loading" },
  discarded: { discarded: true },
  frozen: { frozen: true },
  pending: { pendingUrl: "https://next.test" },
  internal: { url: "chrome://settings/" },
})) {
  test(`protects ${label} tabs`, () =>
    assert.equal(
      eligible({ ...tab, ...patch } as Tab, defaults, undefined, undefined, now)
        .ok,
      false,
    ));
}
test("audio and ungrouped protection are configurable", () => {
  assert.equal(
    eligible(
      { ...tab, audible: true },
      { ...defaults, protectAudio: false },
      undefined,
      undefined,
      now,
    ).ok,
    true,
  );
  assert.equal(
    eligible(
      tab,
      { ...defaults, protectUngrouped: true },
      undefined,
      undefined,
      now,
    ).ok,
    false,
  );
});
test("uses max of native and locally observed activation, rejects invalid timestamps", () => {
  assert.equal(activityTime(tab, now - 100, now), now - 100);
  assert.equal(
    activityTime({ ...tab, lastAccessed: NaN }, undefined, now),
    now,
  );
  assert.equal(
    activityTime({ ...tab, lastAccessed: now + 1 }, undefined, now),
    now,
  );
});
test("matches recreated and duplicate groups by title/color, not transient ID", () => {
  const group = {
    id: 99,
    windowId: 2,
    title: "Work",
    color: "blue" as const,
    collapsed: false,
  };
  const settings = {
    ...defaults,
    protectedGroups: [
      { key: groupKey(group), title: "Work", color: "blue" as const },
    ],
  };
  assert.equal(
    eligible({ ...tab, groupId: 99 }, settings, group, undefined, now).ok,
    false,
  );
  assert.equal(
    eligible({ ...tab, groupId: 99 }, defaults, undefined, undefined, now).ok,
    false,
  );
  assert.equal(
    eligible({ ...tab, groupId: 99 }, defaults, group, undefined, now).ok,
    true,
  );
});
test("rejects invalid intervals and normalizes persisted settings", () => {
  for (const value of [0, -1, NaN, Infinity, 0.5, 525601])
    assert.throws(() => validateSettings({ inactivityMinutes: value }));
  assert.equal(
    validateSettings({ inactivityMinutes: 120 }).inactivityMinutes,
    120,
  );
  assert.throws(() => validateSettings({ protectAudio: "false" }));
  assert.equal(validateSettings({}).protectAudio, true);
});
test("only restores safe http(s) URLs without embedded credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/a",
    "https://a:b@example.com",
    "data:text/html,a",
    "bad",
  ])
    assert.equal(safeUrl(url), false);
  assert.equal(safeUrl("https://example.com/a?q=x#b"), true);
});

test("old settings stay strict and explicit opt-in allows only stable sleeping tabs", () => {
  assert.equal(validateSettings({}).archiveUnverifiable, false);
  assert.throws(() => validateSettings({ archiveUnverifiable: "yes" }));
  const settings = { ...defaults, archiveUnverifiable: true };
  assert.equal(
    eligible(
      { ...tab, discarded: true, status: "unloaded" },
      settings,
      undefined,
      undefined,
      now,
    ).ok,
    true,
  );
  assert.equal(
    eligible({ ...tab, frozen: true }, settings, undefined, undefined, now).ok,
    true,
  );
  assert.equal(
    eligible({ ...tab, status: "loading" }, settings, undefined, undefined, now)
      .ok,
    false,
  );
  assert.equal(
    eligible(
      { ...tab, discarded: true, active: true },
      settings,
      undefined,
      undefined,
      now,
    ).ok,
    false,
  );
});
