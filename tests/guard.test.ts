import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSync } from "esbuild";
const code = buildSync({
  entryPoints: ["src/guard.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
}).outputFiles[0]!.text;
function page(allowUnload?: boolean) {
  class PageEventTarget extends EventTarget {}
  const window = new PageEventTarget();
  const document = {
    readyState: "loading",
    featurePolicy:
      allowUnload === undefined
        ? undefined
        : { allowsFeature: () => allowUnload },
  };
  const ctx = {
    window,
    document,
    EventTarget: PageEventTarget,
    Object,
    Boolean,
  };
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

test("blocked unload registration is skipped, while allowed/unknown policy keeps native events", () => {
  for (const allowed of [false, true, undefined]) {
    const p = page(allowed);
    let calls = 0;
    p.addEventListener("unload", () => calls++);
    p.dispatchEvent(new Event("unload"));
    assert.equal(calls, allowed === false ? 0 : 1);
    assert.equal(p.__quietArchiveProbeV1().safe, true);
  }
});
test("upgrade patch is idempotent and preserves old unsafe or missing probes", () => {
  const upgrade = buildSync({
    stdin: {
      contents:
        'import { patchBlockedUnload } from "./src/unload.ts"; patchBlockedUnload();',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
  }).outputFiles[0]!.text;
  for (const existing of [false, true]) {
    class Target extends EventTarget {}
    const window = new Target();
    const oldProbe = () => ({ safe: false });
    if (existing)
      Object.defineProperty(window, "__quietArchiveProbeV1", {
        value: oldProbe,
      });
    const ctx = vm.createContext({
      window,
      document: { featurePolicy: { allowsFeature: () => false } },
      EventTarget: Target,
    });
    vm.runInContext(upgrade, ctx);
    const patched = Target.prototype.addEventListener;
    vm.runInContext(upgrade, ctx);
    assert.equal(Target.prototype.addEventListener, patched);
    assert.equal(
      Object.prototype.hasOwnProperty.call(window, "__quietArchiveProbeV1"),
      existing,
    );
    if (existing) assert.equal((window as any).__quietArchiveProbeV1, oldProbe);
    let calls = 0;
    window.addEventListener("unload", () => calls++);
    window.dispatchEvent(new Event("unload"));
    assert.equal(calls, 0);
    window.addEventListener("beforeunload", () => calls++);
    window.dispatchEvent(new Event("beforeunload"));
    assert.equal(calls, 1);
  }
});
