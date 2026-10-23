import {
  defaults,
  type Settings,
  type Tab,
  type Group,
  type GroupRule,
} from "./model.js";
export const groupKey = (g: Pick<Group, "title" | "color">): string =>
  JSON.stringify([g.title ?? "", g.color]);
export function safeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
}
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid settings");
  const v = value as Record<string, unknown>;
  const result = { ...defaults };
  for (const key of [
    "enabled",
    "protectAudio",
    "protectUngrouped",
    "notifications",
  ] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== "boolean") throw new Error(`Invalid ${key}`);
      result[key] = v[key];
    }
  }
  if (v.inactivityMinutes !== undefined) {
    const n = v.inactivityMinutes;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 525600)
      throw new Error("Choose a whole number from 1 to 525600 minutes");
    result.inactivityMinutes = n;
  }
  if (v.protectedGroups !== undefined) {
    if (!Array.isArray(v.protectedGroups) || v.protectedGroups.length > 1000)
      throw new Error("Invalid group rules");
    result.protectedGroups = v.protectedGroups.map((g: GroupRule) => {
      if (
        !g ||
        typeof g.title !== "string" ||
        g.title.length > 2000 ||
        ![
          "grey",
          "blue",
          "red",
          "yellow",
          "green",
          "pink",
          "purple",
          "cyan",
          "orange",
        ].includes(g.color) ||
        g.key !== groupKey(g)
      )
        throw new Error("Invalid group rule");
      return { key: g.key, title: g.title, color: g.color };
    });
  }
  return result;
}
export function activityTime(
  tab: Tab,
  local: number | undefined,
  now: number,
): number {
  const times = [tab.lastAccessed, local].filter(
    (t): t is number =>
      typeof t === "number" && Number.isFinite(t) && t > 0 && t <= now,
  );
  return times.length ? Math.max(...times) : now;
}
export function eligible(
  tab: Tab,
  s: Settings,
  group: Group | undefined,
  local: number | undefined,
  now: number,
): { ok: boolean; reason: string } {
  let reason = "";
  if (!s.enabled) reason = "paused";
  else if (tab.active || tab.pinned || tab.highlighted)
    reason = "active / pinned / selected";
  else if (tab.incognito) reason = "incognito";
  else if (!tab.url || !safeUrl(tab.url)) reason = "unsupported URL";
  else if (
    tab.pendingUrl ||
    tab.status !== "complete" ||
    tab.discarded ||
    tab.frozen
  )
    reason = "unavailable / loading";
  else if (s.protectAudio && tab.audible) reason = "audio";
  else if (tab.groupId === -1 && s.protectUngrouped) reason = "ungrouped";
  else if (
    tab.groupId !== -1 &&
    (!group || s.protectedGroups.some((r) => r.key === groupKey(group)))
  )
    reason = "protected group";
  else if (now - activityTime(tab, local, now) < s.inactivityMinutes * 60000)
    reason = "recent";
  return { ok: !reason, reason: reason || "eligible" };
}
