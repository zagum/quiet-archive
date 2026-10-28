import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { initialState } from "../src/model.js";

const code = buildSync({
  entryPoints: ["src/background.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
}).outputFiles[0]!.text;
const tick = () => new Promise<void>((r) => setImmediate(r));
async function background(failFirstQuery = false) {
  let disk = initialState();
  let session: unknown;
  let queries = 0;
  let title = "Closure";
  let installed: () => void;
  const injections: number[] = [];
  const extraTabs: any[] = [];
  let message: (...args: any[]) => boolean;
  const event = () => ({ addListener: (_fn: unknown) => {} });
  const group = {
    id: 7,
    windowId: 1,
    title: "Work",
    color: "blue",
    collapsed: false,
  };
  const chrome = {
    storage: {
      local: {
        setAccessLevel: async () => {},
        get: async () => ({ state: structuredClone(disk) }),
        set: async (v: any) => {
          disk = structuredClone(v.state);
        },
      },
      session: {
        get: async () => ({ session }),
        set: async (v: any) => {
          session = v.session;
        },
      },
    },
    tabs: {
      query: async () => {
        if (failFirstQuery && queries++ === 0)
          throw Error("Temporary startup failure");
        return [
          {
            id: 1,
            windowId: 1,
            index: 0,
            url: "https://example.com",
            active: true,
            pinned: false,
            groupId: 7,
            lastAccessed: Date.now(),
            status: "complete",
          },
          ...extraTabs,
        ];
      },
      onActivated: event(),
      onUpdated: event(),
      onCreated: event(),
      onRemoved: event(),
      onReplaced: event(),
    },
    scripting: {
      executeScript: async (injection: any) => {
        assert.equal(injection.world, "MAIN");
        assert.equal(injection.target.allFrames, true);
        assert.equal(typeof injection.func, "function");
        injections.push(injection.target.tabId);
        return [];
      },
    },
    webNavigation: { onCommitted: event() },
    tabGroups: {
      // Chromium's query can require a current window even for an unfiltered query.
      query: async () => {
        throw Error("No current window");
      },
      get: async (id: number) => {
        assert.equal(id, 7);
        return group;
      },
      onCreated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    alarms: {
      get: async () => undefined,
      create: async () => {},
      onAlarm: event(),
    },
    runtime: {
      id: "extension",
      getURL: (p: string) => `chrome-extension://extension/${p}`,
      onStartup: event(),
      onInstalled: {
        addListener: (fn: () => void) => {
          installed = fn;
        },
      },
      onMessage: {
        addListener: (fn: any) => {
          message = fn;
        },
      },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async (v: { title: string }) => {
        title = v.title;
      },
    },
    notifications: { onClicked: event(), onButtonClicked: event() },
  };
  vm.runInNewContext(code, {
    chrome,
    crypto,
    console: { error() {} },
    URL,
    Date,
    structuredClone,
    setTimeout,
  });
  await tick();
  return {
    update: async () => {
      extraTabs.push(
        { id: 2, groupId: -1, url: "chrome://settings" },
        { id: 3, groupId: -1, url: "https://sleeping.test", discarded: true },
        { id: 4, groupId: -1, url: "https://frozen.test", frozen: true },
        { id: 5, groupId: -1, url: "https://private.test", incognito: true },
      );
      installed();
      await tick();
      return injections;
    },
    title: () => title,
    scan: () =>
      new Promise<any>((reply) =>
        message(
          { type: "scan" },
          { id: "extension", url: "chrome-extension://extension/popup.html" },
          reply,
        ),
      ),
    state: () =>
      new Promise<any>((reply) =>
        message(
          { type: "state" },
          { id: "extension", url: "chrome-extension://extension/popup.html" },
          reply,
        ),
      ),
  };
}
test("background state and groups remain available without a current-window query", async () => {
  const app = await background();
  const result = await app.state();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.groups[0].title, "Work");
});
test("background retries initialization after a transient startup failure", async () => {
  const app = await background(true);
  const result = await app.state();
  assert.equal(result.ok, true, result.error);
});

test("successful manual check clears the previous toolbar error immediately", async () => {
  const app = await background(true);
  assert.match(app.title(), /Temporary startup failure/);
  const result = await app.scan();
  assert.equal(result.ok, true, result.error);
  assert.equal(app.title(), "Closure");
});

test("extension update patches existing live HTTP pages without touching sleeping or restricted tabs", async () => {
  const app = await background();
  assert.deepEqual(await app.update(), [1]);
});
