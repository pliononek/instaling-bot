/* InstaLing Bot — page-context hook (MAIN world, document_start).
 * Przechwytuje odpowiedzi XHR/fetch dla endpointów sesji i publikuje je
 * jako CustomEvent("il:api") z JSON-em w e.detail (string, bezpieczny
 * między światami JS). Działa też jako fallback dla content.js.
 */
(() => {
  "use strict";
  if (window.__IL_HOOKED__) return;
  window.__IL_HOOKED__ = true;

  const API_RE = /\/app\/session\/server\/actions\/([a-z_]+)\.php/i;
  let lastWordId = null;

  function wordIdFromBody(body) {
    try {
      if (typeof body === "string") {
        const params = new URLSearchParams(body);
        return params.get("word_id");
      }
      if (body && typeof body.get === "function") {
        const value = body.get("word_id");
        return value == null ? null : String(value);
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function emit(name, data, body) {
    try {
      document.dispatchEvent(
        new CustomEvent("il:api", {
          detail: JSON.stringify({
            name,
            data,
            body: typeof body === "string" ? body : null,
            ts: Date.now(),
          }),
        })
      );
    } catch (_) {
      /* ignorujemy błędy serializacji */
    }
  }

  function handle(name, data, wordId) {
    if (!data || typeof data !== "object") return;
    if (name === "generate_next_word" && data.id) {
      lastWordId = String(data.id);
    }
    if (name === "save_answer") {
      data.__word_id = wordId || lastWordId;
    }
    emit(name, data, null);
  }

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url) {
    this.__ilUrl = typeof url === "string" ? url : String(url);
    return origOpen.apply(this, arguments);
  };

  XHR.send = function (body) {
    const xhr = this;
    xhr.addEventListener("load", () => {
      const match = (xhr.__ilUrl || "").match(API_RE);
      if (!match) return;
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (_) {
        return;
      }
      handle(match[1], data, wordIdFromBody(body));
    });
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url =
        typeof input === "string"
          ? input
          : input && typeof input.url === "string"
            ? input.url
            : "";
      const requestWordId = init ? wordIdFromBody(init.body) : null;
      return origFetch.apply(this, arguments).then((response) => {
        const match = url.match(API_RE);
        if (!match) return response;
        try {
          response
            .clone()
            .json()
            .then((data) => handle(match[1], data, requestWordId))
            .catch(() => {});
        } catch (_) {
          /* kloon może się nie udać dla body użytego już przez stronę */
        }
        return response;
      });
    };
  }

  document.addEventListener("il:ping", () => {
    document.dispatchEvent(new CustomEvent("il:pong"));
  });
})();
