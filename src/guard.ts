// Runs in MAIN at document_start. Never reads or stores form contents.
(() => {
  if (Object.prototype.hasOwnProperty.call(window, "__quietArchiveProbeV1"))
    return;
  let edited = false;
  let beforeUnload = false;
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (this === window && type === "beforeunload" && listener)
      beforeUnload = true;
    return add.call(this, type, listener, options);
  };
  const mark = () => {
    edited = true;
  };
  add.call(window, "input", mark, true);
  add.call(window, "change", mark, true);
  Object.defineProperty(window, "__quietArchiveProbeV1", {
    value: () => ({ safe: !edited && !beforeUnload && !window.onbeforeunload }),
    writable: false,
    configurable: false,
  });
})();
