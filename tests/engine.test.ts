import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine, type Port } from "../src/engine.js";
import {
  initialState,
  type Tab,
  type State,
  type Entry,
} from "../src/model.js";
const now = 2_000_000_000;
function setup() {
  let disk = initialState();
  let failSave = false;
  let safe = true;
  let removeFails = false;
  let creates = 0;
  const tabs = new Map<number, Tab>([
    [
      1,
      {
        id: 1,
        windowId: 1,
        index: 1,
        url: "https://example.com",
        title: "Example",
        active: false,
        pinned: false,
        groupId: -1,
        status: "complete",
        lastAccessed: now - 90_000_000,
      },
    ],
  ]);
  const port: Port = {
    session: "s1",
    now: () => now,
    load: async () => structuredClone(disk),
    save: async (s) => {
      if (failSave) throw Error("disk full");
      disk = structuredClone(s);
    },
    tabs: async () => [...tabs.values()],
    get: async (id) => tabs.get(id),
    groups: async () => [],
    activity: async () => undefined,
    safe: async () => safe,
    remove: async (id) => {
      assert.equal(disk.archive[0]?.status, "pending");
      if (removeFails) return;
      tabs.delete(id);
    },
    create: async (e) => {
      creates++;
      const t = { ...tabs.get(1)!, id: 100 + creates, url: e.url };
      tabs.set(t.id, t);
      return t.id;
    },
    group: async () => {},
    notify: async () => {},
  };
  return {
    port,
    engine: new Engine(port),
    tabs,
    disk: () => disk,
    setDisk: (s: State) => {
      disk = s;
    },
    failSave: () => {
      failSave = true;
    },
    unsafe: () => {
      safe = false;
    },
    cancel: () => {
      removeFails = true;
    },
    creates: () => creates,
  };
}
const entry = (status: Entry["status"] = "pending"): Entry => ({
  id: "a",
  batchId: "b",
  url: "https://example.com",
  title: "Example",
  closedAt: now,
  lastActiveAt: now - 90_000_000,
  sourceTabId: 1,
  sourceWindowId: 1,
  sourceSession: "s1",
  index: 1,
  status,
});
test("journals before closing and records automatic batch for Undo", async () => {
  const x = setup();
  await x.engine.scan();
  assert.equal(x.tabs.size, 0);
  assert.equal(x.disk().archive[0]?.status, "closed");
  assert.equal(x.disk().lastBatch, x.disk().archive[0]?.batchId);
});
test("disk failure never removes a tab", async () => {
  const x = setup();
  x.failSave();
  await assert.rejects(x.engine.scan());
  assert.equal(x.tabs.size, 1);
});
test("unknown/dirty document never closes", async () => {
  const x = setup();
  x.unsafe();
  await x.engine.scan();
  assert.equal(x.tabs.size, 1);
  assert.equal(x.disk().archive.length, 0);
});
test("cancelled removal does not create a false archive entry", async () => {
  const x = setup();
  x.cancel();
  await x.engine.scan();
  assert.equal(x.disk().archive.length, 0);
});
test("active change during preflight is rechecked after journal write", async () => {
  const x = setup();
  const save = x.port.save;
  x.port.save = async (s) => {
    await save(s);
    x.tabs.get(1)!.active = true;
  };
  await x.engine.scan();
  assert.equal(x.tabs.size, 1);
  assert.equal(x.disk().archive.length, 0);
});
test("recovers absent pending tab after worker suspension", async () => {
  const x = setup();
  x.setDisk({ ...initialState(), archive: [entry()] });
  x.tabs.clear();
  await x.engine.recover();
  assert.equal(x.disk().archive[0]?.status, "closed");
});
test("retains uncertain live pending tab and never matches recycled IDs across browser sessions", async () => {
  const x = setup();
  x.setDisk({ ...initialState(), archive: [entry()] });
  await x.engine.recover();
  assert.equal(x.disk().archive[0]?.status, "uncertain");
  x.setDisk({
    ...initialState(),
    archive: [{ ...entry(), sourceSession: "old" }],
  });
  await x.engine.recover();
  assert.equal(x.disk().archive[0]?.status, "uncertain");
});
test("restore removes successful entries and retains failed URLs", async () => {
  const x = setup();
  x.setDisk({
    ...initialState(),
    archive: [
      entry("closed"),
      { ...entry("closed"), id: "bad", url: "javascript:alert(1)" },
    ],
  });
  const result = await x.engine.restore(["a", "bad"]);
  assert.equal(result.restored, 1);
  assert.equal(result.failed, 1);
  assert.equal(x.disk().archive[0]?.id, "bad");
});
test("restore intent is durable before create and failed save prevents create", async () => {
  const x = setup();
  x.setDisk({ ...initialState(), archive: [entry("closed")] });
  x.failSave();
  await assert.rejects(x.engine.restore(["a"]));
  assert.equal(x.creates(), 0);
});
test("interrupted restore without returned tab ID is retained as uncertain, never auto-retried", async () => {
  const x = setup();
  x.setDisk({ ...initialState(), archive: [entry("restoring")] });
  await x.engine.recover();
  assert.equal(x.disk().archive[0]?.status, "uncertain");
  assert.equal(x.creates(), 0);
});
test("parallel requests serialize so a tab is not archived twice", async () => {
  const x = setup();
  await Promise.all([x.engine.scan(), x.engine.scan()]);
  assert.equal(x.disk().archive.length, 1);
});
test("keeps protected group safe while a rename migration is queued behind scan", async () => {
  const x = setup();
  const oldKey = '["Work","blue"]';
  x.setDisk({
    ...initialState(),
    settings: {
      ...initialState().settings,
      protectedGroups: [{ key: oldKey, title: "Work", color: "blue" }],
    },
  });
  x.tabs.get(1)!.groupId = 7;
  const renamed = {
    id: 7,
    windowId: 1,
    title: "Renamed",
    color: "blue" as const,
    collapsed: false,
  };
  x.port.groups = async () => [renamed];
  x.port.protectedGroup = (_group, settings) =>
    settings.protectedGroups.some((r) => r.key === oldKey);
  const scan = x.engine.scan();
  const migration = x.engine.updateSettings({
    protectedGroups: [
      { key: '["Renamed","blue"]', title: "Renamed", color: "blue" },
    ],
  });
  await Promise.all([scan, migration]);
  assert.equal(x.tabs.size, 1);
  assert.equal(x.disk().archive.length, 0);
});
test("keeps a recoverable URL when a live pending removal may still finish after worker restart", async () => {
  const x = setup();
  x.setDisk({ ...initialState(), archive: [entry()] });
  await x.engine.recover();
  x.tabs.clear();
  assert.equal(x.disk().archive.length, 1);
  assert.equal(x.disk().archive[0]?.status, "uncertain");
});
test("does not starve eligible tabs behind more than 2000 protected tabs", async () => {
  const x = setup();
  const candidate = x.tabs.get(1)!;
  x.tabs.clear();
  for (let id = 1; id <= 2000; id++)
    x.tabs.set(id, { ...candidate, id, active: true });
  x.tabs.set(2001, { ...candidate, id: 2001 });
  await x.engine.scan();
  assert.equal(x.tabs.has(2001), false);
  assert.equal(x.tabs.size, 2000);
});
