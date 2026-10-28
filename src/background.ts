import { patchBlockedUnload } from "./unload.js";
import { Engine, type Port } from "./engine.js";
import {
  initialState,
  type State,
  type Tab,
  type Entry,
  type Group,
  type Safety,
} from "./model.js";
import { groupKey, validateSettings, safeUrl } from "./policy.js";
const ALARM = "quiet-archive-scan";
const NOTIFICATION = "quiet-archive-undo";
interface Session {
  id: string;
  activity: Record<string, number>;
  bindings: Record<string, string>;
  unsafe: Record<string, boolean>;
}
const latestGroupKeys = new Map<number, string>();
let session: Session;
let sessionQueue: Promise<unknown> = Promise.resolve();
function sessionChange(fn: () => void): Promise<void> {
  const task = sessionQueue.then(async () => {
    fn();
    await chrome.storage.session.set({ session });
  });
  sessionQueue = task.catch(() => {});
  return task;
}
function toTab(t: chrome.tabs.Tab): Tab {
  return { ...t, id: t.id! };
}
async function getTab(id: number): Promise<Tab | undefined> {
  try {
    return toTab(await chrome.tabs.get(id));
  } catch {
    return undefined;
  }
}
async function load(): Promise<State> {
  const { state } = await chrome.storage.local.get<{ state?: State }>("state");
  if (state === undefined) return initialState();
  if (!state || state.version !== 1 || !Array.isArray(state.archive))
    throw Error(
      "Stored data is unreadable. Export a backup from extension storage before resetting.",
    );
  return { ...state, settings: validateSettings(state.settings) } as State;
}
async function safe(tabId: number): Promise<Safety> {
  if (session.unsafe[tabId]) return "unsafe";
  try {
    const tab = await getTab(tabId);
    // Do not wake discarded/frozen pages to inspect them.
    if (!tab || tab.discarded || tab.frozen) return "unknown";
    const before = await chrome.webNavigation.getAllFrames({ tabId });
    if (!before?.length) return "unknown";
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        const probe = (
          window as unknown as {
            __quietArchiveProbeV1?: () => { safe: boolean };
          }
        ).__quietArchiveProbeV1;
        if (typeof probe !== "function") return "unknown";
        return probe().safe === true ? "safe" : "unsafe";
      },
    });
    // Remember detected edits across worker suspension and later tab discarding.
    if (results.some((r) => r.result === "unsafe")) {
      try {
        await sessionChange(() => {
          session.unsafe[tabId] = true;
        });
      } catch (error) {
        report(error);
      } // A failed latch write must never turn unsafe into unknown.
      return "unsafe";
    }
    const after = await chrome.webNavigation.getAllFrames({ tabId });
    return after &&
      before.length === after.length &&
      results.length === after.length &&
      after.every(
        (f) =>
          before.some(
            (b) => b.frameId === f.frameId && b.documentId === f.documentId,
          ) &&
          results.some(
            (r) =>
              r.frameId === f.frameId &&
              r.documentId === f.documentId &&
              r.result === "safe",
          ),
      )
      ? "safe"
      : "unknown";
  } catch {
    return "unknown";
  }
}
async function create(e: Entry): Promise<number> {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const original =
    e.sourceSession === session.id
      ? windows.find((w) => w.id === e.sourceWindowId)
      : undefined;
  const target = original ?? windows.find((w) => w.focused) ?? windows[0];
  if (!target?.id) {
    const w = await chrome.windows.create({ url: e.url, focused: false });
    const tab = w?.tabs?.[0];
    if (!tab?.id) throw Error("Could not create window");
    return tab.id;
  }
  try {
    return (
      await chrome.tabs.create({
        windowId: target.id,
        url: e.url,
        active: false,
      })
    ).id!;
  } catch (error) {
    if (
      (await chrome.windows.getAll({ windowTypes: ["normal"] })).some(
        (w) => w.id === target.id,
      )
    )
      throw error;
    return (await chrome.tabs.create({ url: e.url, active: false })).id!;
  }
}
// tabGroups.query() can fail with "No current window" when a profile has no
// focused window. Enumerate actual group IDs in this profile instead.
async function allGroups(): Promise<Group[]> {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const ids = [...new Set(tabs.map((t) => t.groupId).filter((id) => id >= 0))];
  const groups = await Promise.all(
    ids.map(async (id) => {
      try {
        return await chrome.tabGroups.get(id);
      } catch {
        return undefined;
      } // Group/window closed during enumeration.
    }),
  );
  return groups.filter((g): g is chrome.tabGroups.TabGroup => !!g);
}
let initializing: Promise<Engine> | undefined;
function ready(): Promise<Engine> {
  if (!initializing)
    initializing = initialize().catch((error) => {
      initializing = undefined; // A later alarm/window/message must be able to retry.
      throw error;
    });
  return initializing;
}
async function initialize(): Promise<Engine> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const stored = await chrome.storage.session.get<{ session?: Session }>(
    "session",
  );
  session = stored.session ?? {
    id: crypto.randomUUID(),
    activity: {},
    bindings: {},
    unsafe: {},
  };
  session.unsafe ??= {};
  const tabs = await chrome.tabs.query({});
  const groups = await allGroups();
  for (const t of tabs)
    if (
      t.id !== undefined &&
      session.activity[t.id] === undefined &&
      (!Number.isFinite(t.lastAccessed) || !t.lastAccessed)
    )
      session.activity[t.id] = Date.now();
  for (const g of groups) {
    if (session.bindings[g.id] === undefined)
      session.bindings[g.id] = groupKey(g);
    if (!latestGroupKeys.has(g.id)) latestGroupKeys.set(g.id, groupKey(g));
  }
  await chrome.storage.session.set({ session });
  const port: Port = {
    session: session.id,
    now: () => Date.now(),
    load,
    save: async (state) => chrome.storage.local.set({ state }),
    tabs: async () =>
      (await chrome.tabs.query({ windowType: "normal" }))
        .filter((t) => t.id !== undefined)
        .map(toTab),
    get: getTab,
    groups: () => allGroups(),
    protectedGroup: (g, s) =>
      s.protectedGroups.some(
        (r) =>
          r.key === session.bindings[g.id] ||
          r.key === latestGroupKeys.get(g.id),
      ),
    activity: async (id) => session.activity[id],
    safe,
    remove: (id) => chrome.tabs.remove(id),
    create,
    group: async (id, e, map) => {
      if (!e.group) return;
      const tab = await chrome.tabs.get(id);
      const key = JSON.stringify([
        e.sourceSession,
        e.sourceWindowId,
        e.group.id,
        tab.windowId,
      ]);
      let groupId = map.get(key);
      if (groupId === undefined) {
        groupId = await chrome.tabs.group({ tabIds: [id] });
        await chrome.tabGroups.update(groupId, {
          title: e.group.title,
          color: e.group.color as chrome.tabGroups.Color,
          collapsed: e.group.collapsed,
        });
        map.set(key, groupId);
      } else await chrome.tabs.group({ tabIds: [id], groupId });
    },
    notify: async (_batch, count) => {
      await chrome.notifications.create(NOTIFICATION, {
        type: "basic",
        iconUrl: "icons/128.png",
        title: `${count} tab${count === 1 ? "" : "s"} archived`,
        message:
          "Safely stored on this device. Click to view your archive and Undo.",
        buttons: [{ title: "Undo last batch" }],
      });
    },
  };
  const engine = new Engine(port);
  for (const g of groups) {
    const previous = session.bindings[g.id];
    if (previous && previous !== groupKey(g)) {
      await engine.followGroup(previous, g);
      session.bindings[g.id] = groupKey(g);
    }
  }
  await chrome.storage.session.set({ session });
  await engine.recover();
  await ensureAlarm();
  return engine;
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM)))
    await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
function report(error: unknown) {
  console.error("Closure:", error);
  void chrome.action.setBadgeText({ text: "!" });
  void chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
  void chrome.action.setTitle({ title: `Closure: ${String(error)}` });
}
async function checkTabs() {
  await (await ready()).scan();
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "Closure" });
}
async function runScan() {
  try {
    await checkTabs();
  } catch (error) {
    report(error);
  }
}
// Register listeners synchronously; ready gates work, never registration.
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void runScan();
});
chrome.runtime.onStartup.addListener(() => {
  void ready().then(ensureAlarm).then(runScan).catch(report);
});
async function patchOpenPages(): Promise<void> {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  await Promise.all(
    tabs
      .filter(
        (t) =>
          t.id !== undefined &&
          !t.incognito &&
          !t.discarded &&
          !t.frozen &&
          t.url &&
          safeUrl(t.url),
      )
      .map(async (t) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: t.id!, allFrames: true },
            world: "MAIN",
            func: patchBlockedUnload,
          });
        } catch {
          /* Restricted frames stay untouched; no safety probe is installed. */
        }
      }),
  );
}
chrome.runtime.onInstalled.addListener(() => {
  void ready().then(patchOpenPages).catch(report);
});
chrome.webNavigation.onCommitted.addListener((info) => {
  if (info.frameId === 0)
    void ready()
      .then(() =>
        sessionChange(() => {
          delete session.unsafe[info.tabId];
        }),
      )
      .catch(report);
});
chrome.tabs.onActivated.addListener((info) => {
  void ready()
    .then(() =>
      sessionChange(() => {
        session.activity[info.tabId] = Date.now();
      }),
    )
    .catch(report);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url)
    void ready()
      .then(() =>
        sessionChange(() => {
          session.activity[id] = Date.now();
        }),
      )
      .catch(report);
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined)
    void ready()
      .then(() =>
        sessionChange(() => {
          session.activity[tab.id!] = Date.now();
        }),
      )
      .catch(report);
});
chrome.tabs.onRemoved.addListener((id) => {
  void ready()
    .then(() =>
      sessionChange(() => {
        delete session.activity[id];
        delete session.unsafe[id];
      }),
    )
    .catch(report);
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  void ready()
    .then(() =>
      sessionChange(() => {
        delete session.activity[removed];
        if (session.unsafe[removed]) session.unsafe[added] = true;
        delete session.unsafe[removed];
        session.activity[added] = Date.now();
      }),
    )
    .catch(report);
});
chrome.tabGroups.onCreated.addListener((g) => {
  latestGroupKeys.set(g.id, groupKey(g));
  void ready()
    .then(() =>
      sessionChange(() => {
        session.bindings[g.id] = groupKey(g);
      }),
    )
    .catch(report);
});
chrome.tabGroups.onUpdated.addListener((g) => {
  latestGroupKeys.set(g.id, groupKey(g));
  void ready()
    .then(async (engine) => {
      const previous = session.bindings[g.id];
      const next = groupKey(g);
      if (previous && previous !== next) await engine.followGroup(previous, g);
      await sessionChange(() => {
        session.bindings[g.id] = next;
      });
    })
    .catch(report);
});
chrome.tabGroups.onRemoved.addListener((g) => {
  latestGroupKeys.delete(g.id);
  void ready()
    .then(() =>
      sessionChange(() => {
        delete session.bindings[g.id];
      }),
    )
    .catch(report);
});
async function openArchive() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("archive.html") });
}
chrome.notifications.onClicked.addListener((id) => {
  if (id === NOTIFICATION) void openArchive().catch(report);
});
chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id === NOTIFICATION && index === 0)
    void ready()
      .then(async (e) => {
        const s = await e.state();
        await e.restore(
          s.archive
            .filter((x) => x.batchId === s.lastBatch && x.status !== "pending")
            .map((x) => x.id),
        );
        await chrome.notifications.clear(id);
      })
      .catch(report);
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL(""))
  )
    return false;
  void (async () => {
    const engine = await ready();
    switch (message?.type) {
      case "state":
        return {
          state: await engine.state(),
          groups: await allGroups(),
        };
      case "settings":
        await engine.updateSettings(message.patch);
        return {};
      case "scan":
        await checkTabs();
        return {};
      case "restore":
        if (
          !Array.isArray(message.ids) ||
          message.ids.length > 100000 ||
          !message.ids.every((id: unknown) => typeof id === "string")
        )
          throw Error("Invalid selection");
        return engine.restore(message.ids);
      case "archive":
        await openArchive();
        return {};
      default:
        throw Error("Unknown request");
    }
  })()
    .then((data) => reply({ ok: true, data }))
    .catch((error) => reply({ ok: false, error: String(error) }));
  return true;
});
void ensureAlarm().catch(report);
void ready().catch(report);
