import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveDayLabel, relativeAge, hostname } from "../src/view-model.js";
const now = new Date(2026, 9, 24, 10, 0).getTime();
test("groups entries by local calendar day, including yesterday and older dates", () => {
  assert.equal(
    archiveDayLabel(new Date(2026, 9, 24, 0, 1).getTime(), now),
    "Today",
  );
  assert.equal(
    archiveDayLabel(new Date(2026, 9, 23, 23, 59).getTime(), now),
    "Yesterday",
  );
  assert.equal(
    archiveDayLabel(new Date(2026, 9, 20, 12).getTime(), now),
    "This week",
  );
  assert.equal(
    archiveDayLabel(new Date(2025, 9, 20, 12).getTime(), now),
    "October 20, 2025",
  );
});
test("relative ages clamp future entries and round down at minute/hour/day boundaries", () => {
  assert.equal(relativeAge(now + 60000, now), "Just now");
  assert.equal(relativeAge(now - 59000, now), "Just now");
  assert.equal(relativeAge(now - 60000, now), "1m ago");
  assert.equal(relativeAge(now - 3599000, now), "59m ago");
  assert.equal(relativeAge(now - 3600000, now), "1h ago");
  assert.equal(relativeAge(now - 86400000, now), "1d ago");
});
test("shows a readable host without issuing requests and tolerates malformed archive URLs", () => {
  assert.equal(
    hostname("https://www.example.com/private?q=123"),
    "example.com",
  );
  assert.equal(hostname("https://sub.example.com:8443/a"), "sub.example.com");
  assert.equal(hostname("broken"), "broken");
});
import { duration } from "../src/ui.js";
test("formats a custom one-minute duration without pluralizing it", () => {
  assert.equal(duration(1), "1 minute");
  assert.equal(duration(2), "2 minutes");
  assert.equal(duration(60), "1 hour");
  assert.equal(duration(1440), "1 day");
});
