// Self-contained: also serialized by chrome.scripting for already-open pages.
export function patchBlockedUnload(): void {
  const prototype = EventTarget.prototype;
  const marker = "__quietArchiveUnloadPolicyV1";
  if (Object.prototype.hasOwnProperty.call(prototype, marker)) return;
  const add = prototype.addEventListener;
  prototype.addEventListener = function (type, listener, options) {
    if (this === window && type === "unload") {
      try {
        const policy = (
          document as Document & {
            featurePolicy?: { allowsFeature(name: string): boolean };
          }
        ).featurePolicy;
        // Chrome would reject this registration. Do not forward an already
        // forbidden handler through our wrapper and attribute its violation here.
        if (policy?.allowsFeature("unload") === false) return;
      } catch {
        // Unknown policy: preserve the native behavior, including exceptions.
      }
    }
    return add.call(this, type, listener, options);
  };
  Object.defineProperty(prototype, marker, { value: true });
}
