import {
  $,
  request,
  text,
  status,
  busy,
  showUndo,
  date,
  duration,
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
    "archiveUnverifiable",
    "protectUngrouped",
    "notifications",
  ] as const)
    $<HTMLInputElement>(key).checked = s[key];
  $("live").textContent = s.enabled ? "On" : "Paused";
  $("live").classList.toggle("paused", !s.enabled);
  const presets = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-minutes]"),
  ];
  const preset = presets.some(
    (button) => Number(button.dataset.minutes) === s.inactivityMinutes,
  );
  for (const button of presets)
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.minutes) === s.inactivityMinutes),
    );
  $("after-text").textContent =
    `After ${s.inactivityMinutes === 1440 ? "24 hours" : duration(s.inactivityMinutes)} of inactivity`;
  $("presets").classList.toggle("dim", !s.enabled);
  $("custom-row").hidden = preset;
  $("custom-time").setAttribute("aria-expanded", String(!preset));
  $("custom-time").textContent = preset ? "Custom time…" : "Custom time";
  $<HTMLInputElement>("custom-value").value = String(s.inactivityMinutes);
  $<HTMLSelectElement>("custom-unit").value = "1";
  $("archive-count").textContent = String(state.archive.length);
  $("group-count").textContent = String(s.protectedGroups.length);
  $("last-scan").textContent = state.lastScan
    ? `Last checked ${date(state.lastScan)}`
    : "Checks every minute while Chrome is running";
  $("safety-note").textContent = s.archiveUnverifiable
    ? "Unverifiable tabs may close. Only URLs are saved; drafts may be lost. Detected edits stay open."
    : "Unsaved edits and unverifiable pages stay open.";
  const reasons = $("scan-reasons");
  reasons.replaceChildren();
  for (const [reason, count] of Object.entries(state.stats ?? {}))
    reasons.append(text("li", `${count} · ${reason}`));
  if (!reasons.children.length)
    reasons.append(
      text("li", state.lastScan ? "No tabs were skipped." : "No check yet."),
    );
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
    label.title = `${rule.title || "Untitled group"} · ${rule.color} · ${open ? `${count} matching group${count === 1 ? "" : "s"} open` : "Not currently open"}`;
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
  "archiveUnverifiable",
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
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-minutes]",
)) {
  button.addEventListener(
    "click",
    () =>
      void busy(button, () =>
        patch({ inactivityMinutes: Number(button.dataset.minutes) }),
      ),
  );
}
$("custom-time").addEventListener("click", () => {
  const hidden = !$("custom-row").hidden;
  $("custom-row").hidden = hidden;
  $("custom-time").setAttribute("aria-expanded", String(!hidden));
  if (!hidden) $<HTMLInputElement>("custom-value").focus();
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
      status("Check complete. Protection rules applied.");
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
