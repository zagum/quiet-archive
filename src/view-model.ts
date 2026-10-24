export function archiveDayLabel(time: number, now = Date.now()): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  if (time >= today.getTime()) return "Today";
  if (time >= yesterday.getTime()) return "Yesterday";
  if (time >= week.getTime()) return "This week";
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    ...(new Date(time).getFullYear() !== today.getFullYear()
      ? { year: "numeric" as const }
      : {}),
  }).format(time);
}
export function relativeAge(time: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
