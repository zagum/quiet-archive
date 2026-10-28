export interface Tab {
  id: number;
  windowId: number;
  index: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  groupId: number;
  lastAccessed?: number;
  audible?: boolean;
  highlighted?: boolean;
  incognito?: boolean;
  discarded?: boolean;
  frozen?: boolean;
  status?: string;
}
export type Group = Omit<
  Pick<
    chrome.tabGroups.TabGroup,
    "id" | "windowId" | "title" | "color" | "collapsed"
  >,
  "color"
> & { color: `${chrome.tabGroups.Color}` };
export interface GroupRule {
  key: string;
  title: string;
  color: Group["color"];
}
export type Safety = "safe" | "unsafe" | "unknown";
export interface Settings {
  enabled: boolean;
  inactivityMinutes: number;
  protectAudio: boolean;
  archiveUnverifiable: boolean;
  protectUngrouped: boolean;
  notifications: boolean;
  protectedGroups: GroupRule[];
}
export const defaults: Settings = {
  enabled: true,
  inactivityMinutes: 1440,
  protectAudio: true,
  archiveUnverifiable: false,
  protectUngrouped: false,
  notifications: true,
  protectedGroups: [],
};
export interface Entry {
  id: string;
  batchId: string;
  url: string;
  title: string;
  closedAt: number;
  lastActiveAt: number;
  sourceTabId: number;
  sourceWindowId: number;
  sourceSession: string;
  index: number;
  group?: Group & { key: string };
  status: "pending" | "closed" | "uncertain" | "restoring";
  restoredTabId?: number;
  restoreSession?: string;
  note?: string;
}
export interface State {
  version: 1;
  settings: Settings;
  archive: Entry[];
  lastBatch?: string;
  lastScan?: number;
  lastError?: string;
  stats?: Record<string, number>;
}
export const initialState = (): State => ({
  version: 1,
  settings: structuredClone(defaults),
  archive: [],
});
