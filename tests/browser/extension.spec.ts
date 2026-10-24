import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
let context: BrowserContext;
let worker: Worker;
let profile: string;
let base: string;
let id: string;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><title>${req.url?.slice(1) || "Fixture"}</title><h1>Test page</h1><input aria-label="Draft"><iframe src="/frame" ${req.url === "/frame" ? "hidden" : ""}></iframe>`.replace(
      req.url === "/frame" ? '<iframe src="/frame" hidden></iframe>' : "NEVER",
      "",
    ),
  );
});
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  id = new URL(worker.url()).host;
}
test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "quiet-archive-test-"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await launch();
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(profile, { recursive: true, force: true });
});
test("real MV3 popup, safe close, archive search, bulk restore, Undo and restart", async () => {
  const errors: string[] = [];
  const popup = await context.newPage();
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByRole("heading", { name: "Closure" })).toBeVisible();
  await expect(popup.locator("#enabled")).toBeChecked();
  await popup.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(
    popup.getByRole("button", { name: "7 days", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await popup.getByRole("button", { name: "30 days", exact: true }).click();
  await expect(
    popup.getByRole("button", { name: "30 days", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(popup.locator("#status")).toContainText("Saved");
  await popup.locator("#custom-time").click();
  await popup.locator("#custom-value").fill("1");
  await popup.locator("#apply-time").click();
  await expect(popup.locator("#status")).toContainText("Saved");
  const clean = await context.newPage();
  await clean.goto(`${base}/Clean`);
  const dirty = await context.newPage();
  await dirty.goto(`${base}/Draft`);
  await dirty.getByRole("textbox", { name: "Draft" }).fill("Unsaved");
  const pinned = await context.newPage();
  await pinned.goto(`${base}/Pinned`);
  const clean2 = await context.newPage();
  await clean2.goto(`${base}/Second`);
  const groupPage = await context.newPage();
  await groupPage.goto(`${base}/Project`);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const pinned = tabs.find((t) => t.title === "Pinned")!;
    await chrome.tabs.update(pinned.id!, { pinned: true });
    const project = tabs.find((t) => t.title === "Project")!;
    const gid = await chrome.tabs.group({ tabIds: [project.id!] });
    await chrome.tabGroups.update(gid, {
      title: "Design notes",
      color: "blue" as chrome.tabGroups.Color,
    });
  });
  await popup.reload();
  await popup
    .getByRole("checkbox", { name: "Protect Design notes (blue)" })
    .check();
  await expect(popup.locator("#status")).toContainText("saved");
  await popup.bringToFront();
  // Move the worker clock forward; native tabs.lastAccessed stays untouched.
  await worker.evaluate(() => {
    const original = Date.now;
    Date.now = () => original() + 2 * 86400000;
  });
  await popup.locator("#scan").click();
  await expect(popup.locator("#status")).toContainText("Check complete");
  await expect.poll(() => clean.isClosed()).toBe(true);
  expect(clean2.isClosed()).toBe(true);
  expect(dirty.isClosed()).toBe(false);
  expect(pinned.isClosed()).toBe(false);
  expect(groupPage.isClosed()).toBe(false);
  const archive = await context.newPage();
  archive.on("pageerror", (e) => errors.push(e.message));
  await archive.goto(`chrome-extension://${id}/archive.html`);
  await expect(archive.locator(".archive-row")).toHaveCount(2);
  await archive.locator("#search").fill("Clean");
  await expect(archive.locator(".archive-row")).toHaveCount(1);
  await archive.locator("#select-all").check();
  await archive.locator("#restore-selected").click();
  await expect(archive.locator("#status")).toContainText("1 restored");
  await archive.locator("#search").fill("");
  await expect(archive.locator(".archive-row")).toHaveCount(1);
  await archive.locator("#undo").click();
  await expect(archive.locator("#status")).toContainText("1 restored");
  await expect(archive.locator(".archive-row")).toHaveCount(0);
  // Seed archive fixtures for the visual review only, then exercise Restore all.
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get<{ state: any }>("state");
    const tab = (await chrome.tabs.query({}))[0]!;
    state.archive = [
      ["Reading for later", "https://example.com/reading", "Research", "blue"],
      [
        "A quieter way to work",
        "https://example.com/journal",
        "Design notes",
        "green",
      ],
      [
        "Weekend inspiration",
        "https://example.com/weekend",
        "Personal",
        "orange",
      ],
    ].map(([title, url, group, color], i) => ({
      id: `visual-${i}`,
      batchId: "visual",
      title,
      url,
      closedAt: new Date().getTime() - i * 3600000,
      lastActiveAt: Date.now() - 86400000,
      sourceTabId: 0,
      sourceWindowId: tab.windowId,
      sourceSession: "fixture",
      index: i,
      status: "closed",
      group: {
        id: i,
        windowId: tab.windowId,
        title: group,
        color,
        collapsed: false,
        key: JSON.stringify([group, color]),
      },
    }));
    state.lastBatch = "visual";
    await chrome.storage.local.set({ state });
  });
  await archive.reload();
  await expect(archive.locator(".archive-row")).toHaveCount(3);
  await archive.setViewportSize({ width: 1280, height: 800 });
  await archive.bringToFront();
  if (process.env.UPDATE_SCREENSHOTS === "1")
    await archive.screenshot({
      path: "docs/screenshots/archive.png",
      fullPage: false,
      animations: "disabled",
    });
  await popup.reload();
  await popup.setViewportSize({ width: 360, height: 850 });
  await expect(popup.locator("#after-text")).toHaveText(
    "After 1 minute of inactivity",
  );
  await expect(popup.locator(".pill[aria-pressed=true]")).toHaveCount(0);
  await popup.bringToFront();
  if (process.env.UPDATE_SCREENSHOTS === "1")
    await popup.screenshot({
      path: "docs/screenshots/popup.png",
      fullPage: true,
      animations: "disabled",
    });
  await expect(
    archive.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await archive.setViewportSize({ width: 390, height: 844 });
  expect(
    await archive.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await archive.setViewportSize({ width: 1280, height: 800 });
  await archive.locator("#restore-all").click();
  await expect(archive.locator("#status")).toContainText("3 restored");
  await expect(archive.locator(".archive-row")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
  await launch();
  const restarted = await context.newPage();
  await restarted.goto(`chrome-extension://${id}/popup.html`);
  await expect(restarted.locator("#custom-value")).toHaveValue("1");
  await expect(
    restarted.getByRole("checkbox", { name: "Protect Design notes (blue)" }),
  ).toBeChecked();
  const alarm = await worker.evaluate(() =>
    chrome.alarms.get("quiet-archive-scan"),
  );
  expect(alarm?.periodInMinutes).toBe(1);
});
test("group recreation and rename protection survive worker stop; failed Undo is reported", async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  // Recreate an ordinary group using a new browser group ID and the saved signature.
  const page = await context.newPage();
  await page.goto(`${base}/Recreated`);
  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(
      (t) => t.title === "Recreated",
    )!;
    const gid = await chrome.tabs.group({ tabIds: [tab.id!] });
    await chrome.tabGroups.update(gid, {
      title: "Design notes",
      color: "blue" as chrome.tabGroups.Color,
    });
  });
  await popup.reload();
  await expect(
    popup.getByRole("checkbox", { name: "Protect Design notes (blue)" }),
  ).toBeChecked();
  await worker.evaluate(async () => {
    const groups = await chrome.tabGroups.query({ title: "Design notes" });
    await chrome.tabGroups.update(groups[0]!.id, {
      title: "Renamed notes",
      color: "purple" as chrome.tabGroups.Color,
    });
  });
  await popup.reload();
  await expect(
    popup.getByRole("checkbox", { name: "Protect Renamed notes (purple)" }),
  ).toBeChecked();
  const cdp = await context.newCDPSession(popup);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await popup.reload();
  await expect(popup.locator("#enabled")).toBeChecked();
  await expect(
    popup.getByRole("checkbox", { name: "Protect Renamed notes (purple)" }),
  ).toBeChecked();
  worker =
    context.serviceWorkers().find((w) => w.url().includes(id)) ??
    (await context.waitForEvent("serviceworker"));
  // tabs.create fails: popup must preserve the entry and report the failed outcome.
  await worker.evaluate(async () => {
    const { state } = await chrome.storage.local.get<{ state: any }>("state");
    state.lastBatch = "failure";
    state.archive = [
      {
        id: "failure-entry",
        batchId: "failure",
        url: "https://example.com/retry",
        title: "Retry me",
        closedAt: Date.now(),
        lastActiveAt: 0,
        sourceTabId: 999,
        sourceWindowId: 999,
        sourceSession: "old",
        index: 0,
        status: "closed",
      },
    ];
    await chrome.storage.local.set({ state });
    chrome.tabs.create = async () => {
      throw Error("Simulated create failure");
    };
  });
  await popup.reload();
  await popup.locator("#undo").click();
  await expect(popup.locator("#status")).toContainText("1 kept in archive");
  await expect(popup.locator("#archive-count")).toHaveText("1");
});
