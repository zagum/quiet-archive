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
import type { Entry } from "./model.js";
import { archiveDayLabel, relativeAge, hostname } from "./view-model.js";
let entries: Entry[] = [];
let selected = new Set<string>();
let undoIds: string[] = [];
const restorable = (e: Entry) =>
  e.status !== "pending" && e.status !== "restoring";
function visible() {
  const query = $<HTMLInputElement>("search").value.trim().toLocaleLowerCase();
  return entries.filter((e) =>
    `${e.title} ${e.url} ${e.group?.title ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
}
function selection() {
  const all = visible().filter(restorable);
  $("selection-count").textContent = `${selected.size} selected`;
  $<HTMLButtonElement>("restore-selected").disabled = !selected.size;
  const input = $<HTMLInputElement>("select-all");
  input.checked = all.length > 0 && all.every((e) => selected.has(e.id));
  input.indeterminate = all.some((e) => selected.has(e.id)) && !input.checked;
}
function render() {
  const list = $("entries");
  list.replaceChildren();
  const found = visible();
  $("empty").hidden = !!found.length;
  $("total").textContent =
    `${entries.length} tab${entries.length === 1 ? "" : "s"}`;
  $<HTMLButtonElement>("restore-all").disabled = !entries.some(restorable);
  if (!found.length) {
    $("empty").querySelector("h2")!.textContent = entries.length
      ? "No matches."
      : "All caught up.";
    $("empty").querySelector("p")!.textContent = entries.length
      ? "Try another title, URL or group name."
      : "Nothing to close the loop on.";
  }
  const days = new Map<string, HTMLElement>();
  const now = Date.now();
  for (const e of found) {
    const day = archiveDayLabel(e.closedAt, now);
    let card = days.get(day);
    if (!card) {
      const section = text("section", "", "archive-day");
      section.append(text("h2", day, "day-heading"));
      card = text("div", "", "card day-card");
      section.append(card);
      list.append(section);
      days.set(day, card);
    }
    const row = text("article", "", "archive-row");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = selected.has(e.id);
    check.disabled = !restorable(e);
    check.setAttribute("aria-label", `Select ${e.title}`);
    check.addEventListener("change", () => {
      if (check.checked) selected.add(e.id);
      else selected.delete(e.id);
      selection();
    });
    row.append(check);
    const icon = text(
      "span",
      hostname(e.url).slice(0, 1).toUpperCase() || "↗",
      "site-icon",
    );
    const palette = [
      "#8a5cf0",
      "#3b78e7",
      "#e8541e",
      "#2f9a52",
      "#d4231b",
      "#f26a10",
      "#24292f",
    ];
    icon.style.backgroundColor =
      palette[hostname(e.url).length % palette.length]!;
    row.append(icon);
    const content = text("div", "", "entry-content");
    content.append(text("h3", e.title));
    const link = text("span", hostname(e.url), "entry-url");
    link.title = e.url;
    content.append(link);
    const meta = text("div", "", "entry-meta");

    if (e.group) {
      const tag = text("span", e.group.title || "Untitled group", "group-tag");
      tag.dataset.color = e.group.color;
      meta.append(tag);
    } else meta.append(text("span", "Ungrouped"));
    content.append(meta);
    if (e.note || e.status === "uncertain")
      content.append(
        text(
          "p",
          e.note ?? "Check open tabs before restoring this recovery entry.",
          "entry-note",
        ),
      );
    if (!restorable(e))
      content.append(
        text(
          "p",
          "Operation in progress. Reopen this page after it finishes.",
          "entry-note",
        ),
      );
    row.append(content);
    const age = text("time", relativeAge(e.closedAt, now), "entry-age");
    age.setAttribute("datetime", new Date(e.closedAt).toISOString());
    age.title = date(e.closedAt);
    row.append(age);
    const restore = text("button", "Restore", "btn-soft") as HTMLButtonElement;
    restore.disabled = !restorable(e);
    restore.addEventListener(
      "click",
      () => void busy(restore, () => restoreIds([e.id])),
    );
    row.append(restore);
    card.append(row);
  }
  selection();
}
async function refresh() {
  const snapshot = await request<Snapshot>("state");
  entries = snapshot.state.archive;
  selected = new Set(
    [...selected].filter((id) =>
      entries.some((e) => e.id === id && restorable(e)),
    ),
  );
  undoIds = showUndo(snapshot.state);
  render();
}
async function restoreIds(ids: string[]) {
  status("Restoring tabs…");
  const result = await request<{ restored: number; failed: number }>(
    "restore",
    { ids },
  );
  await refresh();
  status(
    `${result.restored} restored${result.failed ? `, ${result.failed} could not be restored; kept in archive` : ""}.`,
    !!result.failed,
  );
}
$("search").addEventListener("input", render);
$("select-all").addEventListener("change", () => {
  for (const e of visible().filter(restorable)) {
    if ($<HTMLInputElement>("select-all").checked) selected.add(e.id);
    else selected.delete(e.id);
  }
  render();
});
for (const [id, getIds] of [
  ["restore-all", () => entries.filter(restorable).map((e) => e.id)],
  ["restore-selected", () => [...selected]],
  ["undo", () => undoIds],
] as const)
  $(id).addEventListener(
    "click",
    () => void busy($<HTMLButtonElement>(id), () => restoreIds(getIds())),
  );
$("export").addEventListener(
  "click",
  () =>
    void busy($<HTMLButtonElement>("export"), async () => {
      const snapshot = await request<Snapshot>("state");
      const blob = new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), ...snapshot.state },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `closure-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      status("Backup exported. It contains private tab titles and URLs.");
    }),
);
window.addEventListener(
  "focus",
  () => void refresh().catch((e) => status(String(e), true)),
);
void refresh().catch((e) => status(String(e), true));
