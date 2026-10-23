import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
const code = transformSync(
  readFileSync(new URL("../src/guard.ts", import.meta.url), "utf8"),
  { loader: "ts" },
).code;
function page() {
  const window = new EventTarget();
  const document = { readyState: "loading" };
  const ctx = { window, document, EventTarget, Object, Boolean };
  vm.runInNewContext(code, ctx);
  return window as EventTarget & {
    __quietArchiveProbeV1: () => { safe: boolean };
    onbeforeunload?: unknown;
  };
}
test("document-start guard allows untouched page", () =>
  assert.equal(page().__quietArchiveProbeV1().safe, true));
test("any form editing blocks closure until navigation", () => {
  const p = page();
  p.dispatchEvent(new Event("input"));
  assert.equal(p.__quietArchiveProbeV1().safe, false);
});
test("beforeunload listener registration remains protected even if removed", () => {
  const p = page();
  const f = () => {};
  p.addEventListener("beforeunload", f);
  p.removeEventListener("beforeunload", f);
  assert.equal(p.__quietArchiveProbeV1().safe, false);
});
test("property-based beforeunload blocks closure", () => {
  const p = page();
  p.onbeforeunload = () => {};
  assert.equal(p.__quietArchiveProbeV1().safe, false);
});
