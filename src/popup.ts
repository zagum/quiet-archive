import {
  $,
  request,
  text,
  status,
  busy,
  showUndo,
  date,
  type Snapshot,
} from "./ui.js";
import { groupKey } from "./policy.js";
import type { Settings, GroupRule } from "./model.js";
let snapshot: Snapshot;
let undoIds: string[] = [];
async function refresh() {
  snapshot = await request<Snapshot>("state");
  const { state, groups } = snapshot;
  const s = state.settings;
  for (const key of [
    "enabled",
    "protectAudio",
    "protectUngrouped",
    "notifications",
  ] as const)
    $<HTMLInputElement>(key).checked = s[key];
  $("live").textContent = s.enabled ? "On" : "Paused";
  $("live").classList.toggle("paused", !s.enabled);
  const preset = ["1440", "10080", "43200"].includes(
    String(s.inactivityMinutes),
  );
  $<HTMLSelectElement>("interval").value = preset
    ? String(s.inactivityMinutes)
    : "custom";
  $("custom-row").hidden = preset;
  $<HTMLInputElement>("custom-value").value = String(s.inactivityMinutes);
  $<HTMLSelectElement>("custom-unit").value = "1";
  $("archive-count").textContent = String(state.archive.length);
  $("group-count").textContent = String(s.protectedGroups.length);
  $("last-scan").textContent = state.lastScan
    ? `Last checked ${date(state.lastScan)}`
    : "Checks every minute while Chrome is running";
  const list = $("groups");
  list.replaceChildren();
  const liveKeys = new Set<string>();
  function row(rule: GroupRule, open: boolean, count: number) {
    const label = document.createElement("label");
    label.className = "group-row";
    const dot = text("span", "", "dot");
    dot.dataset.color = rule.color;
    label.append(dot);
    const title = text("span", rule.title || "Untitled group");
    title.append(
      text(
        "small",
        open
          ? `${count} matching group${count === 1 ? "" : "s"} open`
          : "Not currently open",
      ),
    );
    label.append(title);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = s.protectedGroups.some((r) => r.key === rule.key);
    input.setAttribute(
      "aria-label",
      `Protect ${rule.title || "untitled group"} (${rule.color})`,
    );
    input.addEventListener("change", async () => {
      input.disabled = true;
      try {
        const latest = await request<Snapshot>("state");
        const rules = latest.state.settings.protectedGroups.filter(
          (r) => r.key !== rule.key,
        );
        if (input.checked) rules.push(rule);
        await request("settings", { patch: { protectedGroups: rules } });
        await refresh();
        status("Group protection saved.");
      } catch (e) {
        status(String(e), true);
        input.checked = !input.checked;
      } finally {
        input.disabled = false;
      }
    });
    label.append(input);
    list.append(label);
  }
  for (const g of groups) {
    const key = groupKey(g);
    if (liveKeys.has(key)) continue;
    liveKeys.add(key);
    row(
      { key, title: g.title ?? "", color: g.color },
      true,
      groups.filter((x) => groupKey(x) === key).length,
    );
  }
  for (const r of s.protectedGroups) if (!liveKeys.has(r.key)) row(r, false, 0);
  if (!list.children.length)
    list.append(
      text(
        "p",
        "No tab groups yet. Create one in Chrome to protect it.",
        "empty-small",
      ),
    );
  undoIds = showUndo(state);
  if (state.lastError) status(state.lastError, true);
}
async function patch(value: Partial<Settings>) {
  await request("settings", { patch: value });
  await refresh();
  status("Saved for this Chrome profile.");
}
for (const key of [
  "enabled",
  "protectAudio",
  "protectUngrouped",
  "notifications",
] as const)
  $<HTMLInputElement>(key).addEventListener("change", async () => {
    try {
      await patch({ [key]: $<HTMLInputElement>(key).checked });
    } catch (e) {
      status(String(e), true);
      await refresh();
    }
  });
$<HTMLSelectElement>("interval").addEventListener("change", async () => {
  const value = $<HTMLSelectElement>("interval").value;
  $("custom-row").hidden = value !== "custom";
  if (value !== "custom")
    try {
      await patch({ inactivityMinutes: Number(value) });
    } catch (e) {
      status(String(e), true);
    }
});
$("apply-time").addEventListener(
  "click",
  () =>
    void busy($<HTMLButtonElement>("apply-time"), async () => {
      await patch({
        inactivityMinutes:
          Number($<HTMLInputElement>("custom-value").value) *
          Number($<HTMLSelectElement>("custom-unit").value),
      });
    }),
);
$("archive").addEventListener(
  "click",
  () =>
    void busy($<HTMLButtonElement>("archive"), async () => {
      await request("archive");
      window.close();
    }),
);
$("scan").addEventListener(
  "click",
  () =>
    void busy($<HTMLButtonElement>("scan"), async () => {
      status("Checking tabs safely…");
      await request("scan");
      await refresh();
      status("Check complete. Protected and unverifiable tabs stayed open.");
    }),
);
$("undo").addEventListener(
  "click",
  () =>
    void busy($<HTMLButtonElement>("undo"), async () => {
      const result = await request<{ restored: number; failed: number }>(
        "restore",
        { ids: undoIds },
      );
      await refresh();
      status(
        `${result.restored} restored${result.failed ? `, ${result.failed} kept in archive` : ""}.`,
        !!result.failed,
      );
    }),
);
void refresh().catch((e) => status(String(e), true));
