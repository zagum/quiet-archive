import type { Tab, Group, State, Entry, Settings } from "./model.js";
import {
  activityTime,
  eligible,
  groupKey,
  safeUrl,
  validateSettings,
} from "./policy.js";
export interface Port {
  session: string;
  now(): number;
  load(): Promise<State>;
  save(s: State): Promise<void>;
  tabs(): Promise<Tab[]>;
  get(id: number): Promise<Tab | undefined>;
  groups(): Promise<Group[]>;
  protectedGroup?(group: Group, settings: Settings): boolean;
  activity(id: number): Promise<number | undefined>;
  safe(id: number): Promise<boolean>;
  remove(id: number): Promise<void>;
  create(e: Entry): Promise<number>;
  group(id: number, e: Entry, map: Map<string, number>): Promise<void>;
  notify(batch: string, count: number): Promise<void>;
}
export class Engine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private p: Port) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async state(): Promise<State> {
    return this.serial(() => this.p.load());
  }
  async updateSettings(patch: unknown): Promise<void> {
    return this.serial(async () => {
      const s = await this.p.load();
      s.settings = validateSettings({ ...s.settings, ...(patch as object) });
      await this.p.save(s);
    });
  }
  async followGroup(previous: string, group: Group): Promise<void> {
    return this.serial(async () => {
      const s = await this.p.load();
      const key = groupKey(group);
      if (
        s.settings.protectedGroups.some((r) => r.key === previous) &&
        !s.settings.protectedGroups.some((r) => r.key === key)
      ) {
        s.settings.protectedGroups.push({
          key,
          title: group.title ?? "",
          color: group.color,
        });
        await this.p.save(s);
      }
    });
  }
  private check(
    tab: Tab,
    s: Settings,
    groups: Group[],
    local: number | undefined,
  ) {
    const group = groups.find((g) => g.id === tab.groupId);
    if (group && this.p.protectedGroup?.(group, s))
      return { ok: false, reason: "protected group" };
    return eligible(tab, s, group, local, this.p.now());
  }
  async recover(): Promise<void> {
    return this.serial(() => this.reconcile());
  }
  private async reconcile(): Promise<void> {
    const s = await this.p.load();
    let changed = false;
    for (const e of [...s.archive]) {
      if (e.status === "pending") {
        changed = true;
        if (e.sourceSession !== this.p.session) {
          e.status = "uncertain";
          e.note =
            "Browser restarted during closing. Check open tabs before restoring.";
        } else if (await this.p.get(e.sourceTabId)) {
          e.status = "uncertain";
          e.note =
            "Closing was interrupted while this tab was still open. Check open tabs before restoring.";
        } else {
          e.status = "closed";
          s.lastBatch = e.batchId;
        }
      } else if (e.status === "restoring") {
        changed = true;
        const tab =
          e.restoreSession === this.p.session && e.restoredTabId !== undefined
            ? await this.p.get(e.restoredTabId)
            : undefined;
        if (tab && tab.url === e.url)
          s.archive = s.archive.filter((x) => x.id !== e.id);
        else {
          e.status = "uncertain";
          e.note =
            "Restore was interrupted. Check open tabs before retrying to avoid duplicates.";
        }
      }
    }
    if (changed) await this.p.save(s);
  }
  async scan(): Promise<void> {
    return this.serial(async () => {
      await this.reconcile();
      const s = await this.p.load();
      if (!s.settings.enabled) return;
      const batchId = crypto.randomUUID();
      let count = 0;
      const stats: Record<string, number> = {};
      const skip = (why: string) => {
        stats[why] = (stats[why] ?? 0) + 1;
      };
      const groups = await this.p.groups();
      for (const candidate of await this.p.tabs()) {
        if (count >= 50) break;
        const local = await this.p.activity(candidate.id);
        const check = this.check(candidate, s.settings, groups, local);
        if (!check.ok) {
          skip(check.reason);
          continue;
        }
        if (!(await this.p.safe(candidate.id))) {
          skip("unsaved / unverifiable");
          continue;
        }
        const group = groups.find((g) => g.id === candidate.groupId);
        const e: Entry = {
          id: crypto.randomUUID(),
          batchId,
          url: candidate.url!,
          title: candidate.title || candidate.url!,
          closedAt: this.p.now(),
          lastActiveAt: activityTime(candidate, local, this.p.now()),
          sourceTabId: candidate.id,
          sourceWindowId: candidate.windowId,
          sourceSession: this.p.session,
          index: candidate.index,
          group: group ? { ...group, key: groupKey(group) } : undefined,
          status: "pending",
        };
        s.archive.unshift(e);
        await this.p.save(s); // durable before any destructive call
        try {
          const fresh = await this.p.get(candidate.id);
          const freshGroups = await this.p.groups();
          if (
            !fresh ||
            fresh.url !== candidate.url ||
            fresh.groupId !== candidate.groupId ||
            !this.check(
              fresh,
              s.settings,
              freshGroups,
              await this.p.activity(candidate.id),
            ).ok ||
            !(await this.p.safe(candidate.id))
          ) {
            s.archive = s.archive.filter((x) => x.id !== e.id);
            await this.p.save(s);
            skip("changed during check");
            continue;
          }
          // Refresh again after the asynchronous safety probe (activation may have changed).
          const finalGroups = await this.p.groups();
          const final = await this.p.get(candidate.id);
          if (
            !final ||
            final.url !== fresh.url ||
            final.groupId !== fresh.groupId ||
            !this.check(
              final,
              s.settings,
              finalGroups,
              await this.p.activity(final.id),
            ).ok
          ) {
            s.archive = s.archive.filter((x) => x.id !== e.id);
            await this.p.save(s);
            continue;
          }
          await this.p.remove(candidate.id);
        } catch (error) {
          s.lastError = String(error);
        }
        // Never claim closure when beforeunload was cancelled or the tab remains live.
        if (await this.p.get(candidate.id)) {
          s.archive = s.archive.filter((x) => x.id !== e.id);
          skip("close cancelled");
        } else {
          e.status = "closed";
          count++;
          s.lastBatch = batchId;
        }
        await this.p.save(s);
      }
      s.lastScan = this.p.now();
      s.stats = stats;
      await this.p.save(s);
      if (count && s.settings.notifications)
        try {
          await this.p.notify(batchId, count);
        } catch {
          /* popup Undo remains available */
        }
    });
  }
  async restore(ids: string[]): Promise<{ restored: number; failed: number }> {
    return this.serial(async () => {
      const s = await this.p.load();
      const wanted = new Set(ids);
      const groups = new Map<string, number>();
      let restored = 0,
        failed = 0;
      for (const e of [...s.archive].reverse()) {
        if (!wanted.has(e.id)) continue;
        if (
          e.status === "pending" ||
          e.status === "restoring" ||
          !safeUrl(e.url)
        ) {
          failed++;
          continue;
        }
        e.status = "restoring";
        e.restoreSession = this.p.session;
        e.restoredTabId = undefined;
        await this.p.save(s);
        let tabId: number;
        try {
          tabId = await this.p.create(e);
        } catch (error) {
          e.status = "closed";
          e.note = String(error);
          failed++;
          await this.p.save(s);
          continue;
        }
        e.restoredTabId = tabId;
        await this.p.save(s); // recovery can recognize successful create
        try {
          await this.p.group(tabId, e, groups);
        } catch {
          /* URL restored; missing group is cosmetic */
        }
        s.archive = s.archive.filter((x) => x.id !== e.id);
        await this.p.save(s);
        restored++;
      }
      return { restored, failed };
    });
  }
}
