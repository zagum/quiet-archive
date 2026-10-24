import type { State, Group } from "./model.js";
export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export async function request<T = Record<string, never>>(
  type: string,
  extra: object = {},
): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok)
    throw Error(
      response?.error ??
        "Extension did not respond. Reload the extension and try again.",
    );
  return response.data as T;
}
export type Snapshot = { state: State; groups: Group[] };
export const text = (tag: string, value: string, className = "") => {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
};
export function status(value: string, error = false) {
  const el = $("status");
  el.textContent = value;
  el.classList.toggle("error", error);
}
export const date = (value: number) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
export function duration(minutes: number) {
  if (minutes % 1440 === 0)
    return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0)
    return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
export async function busy(button: HTMLButtonElement, fn: () => Promise<void>) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    status(String(e), true);
  } finally {
    button.disabled = false;
  }
}
export function showUndo(state: State) {
  const entries = state.archive.filter(
    (e) => e.batchId === state.lastBatch && e.status !== "pending",
  );
  $("undo-panel").hidden = !entries.length;
  $("undo-copy").textContent =
    `${entries.length} tab${entries.length === 1 ? "" : "s"} in your last batch`;
  return entries.map((e) => e.id);
}
