#!/usr/bin/env python3
"""Buduje samowystarczalny userscript z plików rozszerzenia.

Użycie:
    python3 build_userscript.py

Wejście:
    wtyczka/styles.css
    wtyczka/hooks.js
    wtyczka/content.js

Wyjście:
    instaling-mobile.user.js
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXT = ROOT / "wtyczka"
TARGET = ROOT / "instaling-mobile.user.js"

HEADER = """// ==UserScript==
// @name         InstaLing Bot — uniwersalny asystent
// @namespace    https://instaling.pl/
// @version      2.0.0
// @description  Kreator konta, auto-logowanie i rozwiązywanie sesji InstaLing dla dowolnego ucznia.
// @match        *://*.instaling.pl/*
// @grant        none
// @run-at       document-start
// @connect      api.mymemory.translated.net
// @connect      translate.googleapis.com
// @noframes
// ==/UserScript==

"""

STYLE_TEMPLATE = """(() => {
  "use strict";
  function injectStyle() {
    if (document.getElementById("il-style")) return;
    const style = document.createElement("style");
    style.id = "il-style";
    style.textContent = %s;
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.head || document.documentElement) injectStyle();
  else document.addEventListener("DOMContentLoaded", injectStyle, { once: true });
})();

"""


def build() -> str:
    css = (EXT / "styles.css").read_text(encoding="utf-8")
    hooks = (EXT / "hooks.js").read_text(encoding="utf-8")
    content = (EXT / "content.js").read_text(encoding="utf-8")
    style = STYLE_TEMPLATE % json.dumps(css, ensure_ascii=False)
    return HEADER + style + hooks + "\n" + content


def main() -> None:
    output = build()
    TARGET.write_text(output, encoding="utf-8")
    print(f"zapisano {TARGET.relative_to(ROOT)} ({len(output.encode('utf-8'))} B)")


if __name__ == "__main__":
    main()
