/* InstaLing — uniwersalny asystent ucznia (content script / userscript).
 *
 * Zasady:
 *  - ZERO zahardkodowanych danych logowania i child_id — wszystko z localStorage
 *    (kreator konta) oraz z bieżącej strony/API.
 *  - Odpowiedź: słownik -> nazwa MP3 -> MyMemory -> Google -> surowe tłumaczenie.
 *  - Po save_answer.php dokładna odpowiedź z serwera trafia do słownika.
 *  - Język docelowy tłumacza z language_id (1=en, 2=de, 3=es, 4=fr).
 */
(() => {
  "use strict";
  if (window.__IL_HUD_LOADED__) return;
  window.__IL_HUD_LOADED__ = true;

  const ORIGIN = location.origin;
  const ACTIONS = ORIGIN + "/app/session/server/actions";
  const DICT_KEY = "instaling_dict";
  const USER_KEY = "instaling_user";
  const DELAY_KEY = "instaling_delay_v2";
  const COLLAPSE_KEY = "instaling_hud_collapsed";
  const SETTINGS_KEY = "instaling_settings_open";
  const AUTOSTART_KEY = "instaling_autostart";
  const NO_AUTOLOGIN_KEY = "instaling_no_autologin";
  const WIZARD_SKIP_KEY = "instaling_wizard_skipped";
  const DEFAULT_DELAY_MAX = 5000;
  const DELAY_SPAN = 2000;
  const LANG_BY_ID = { 1: "en", 2: "de", 3: "es", 4: "fr" };

  const state = {
    childId: null,
    version: null,
    languageId: null,
    langCode: "en",
    pendingWords: [],
    lastAnsweredId: null,
    sameWordCount: 0,
    consecutiveErrors: 0,
    autoOn: false,
    autoLoopActive: false,
    busy: false,
    cancelRequested: false,
    solved: 0,
    progressPct: 0,
    delayMax: DEFAULT_DELAY_MAX,
    dictPreviewOpen: false,
    settingsOpen: false,
    pendingForm: null,
    pendingCredentials: null,
    logs: [],
  };

  const $ = (selector, root) => (root || document).querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------------------------------------------------------------- storage */

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  const user = {
    get() {
      const cfg = readJSON(USER_KEY, null);
      return cfg && cfg.login && cfg.password ? cfg : null;
    },
    save(login, password, auto) {
      const cfg = {
        login: String(login || "").trim(),
        password: String(password || ""),
        auto: auto !== false,
        savedAt: new Date().toISOString(),
      };
      writeJSON(USER_KEY, cfg);
      renderAccount();
      return cfg;
    },
    clear() {
      try {
        localStorage.removeItem(USER_KEY);
      } catch (_) {
        /* ignore */
      }
      renderAccount();
    },
  };

  const dict = {
    all() {
      return readJSON(DICT_KEY, {});
    },
    get(id) {
      const value = this.all()[String(id)];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
    set(id, word) {
      if (!id || !word) return;
      const all = this.all();
      all[String(id)] = String(word).trim();
      writeJSON(DICT_KEY, all);
      updateDictCount();
    },
    clear() {
      try {
        localStorage.removeItem(DICT_KEY);
      } catch (_) {
        /* ignore */
      }
      updateDictCount();
    },
    size() {
      return Object.keys(this.all()).length;
    },
  };

  /* Konfiguracja wstrzyknięta przez instalator (config.js). Nigdy nie jest
   * wymagana — użytkownik może wpisać dane w kreatorze w HUD.
   */
  function seedFromInstaller() {
    let cfg = null;
    try {
      cfg = window.__IL_CONFIG__ || null;
    } catch (_) {
      cfg = null;
    }
    if (!cfg || !cfg.login || !cfg.password) return;
    if (user.get()) return;
    user.save(cfg.login, cfg.password, cfg.auto !== false);
    log("Konto zaimportowane z konfiguracji instalatora");
  }

  /* --------------------------------------------------------------- helpers */

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    return el.getClientRects().length > 0;
  }

  function tap(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_) {
      /* starsze Safari */
    }
    try {
      el.click();
    } catch (_) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  function setInput(el, value) {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    try {
      if (setter && setter.set) setter.set.call(el, value);
      else el.value = value;
    } catch (_) {
      el.value = value;
    }
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a", code: "KeyA" }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a", code: "KeyA" }));
  }

  function plainText(value) {
    const text = String(value == null ? "" : value);
    return (text.indexOf("<") >= 0 ? text.replace(/<[^>]*>/g, " ") : text)
      .replace(/\s+/g, " ")
      .trim();
  }

  function isLoginPage() {
    return !!$("#log_email") || /teacher\.php/i.test(location.pathname + location.search);
  }

  function isSessionPage() {
    return /\/app\/session\/app\.php/i.test(location.pathname);
  }

  function isStudentPanel() {
    return /mainPage\.php/i.test(location.pathname) || !!$("a.btn-start-session");
  }

  function parseVersion(text) {
    const match = String(text || "").match(/updateParams\([^;]{0,300}?["']([A-Fa-f0-9]{32})["']/);
    return match ? match[1] : null;
  }

  function detectChildId() {
    const params = new URLSearchParams(location.search);
    for (const key of ["child_id", "student_id", "id"]) {
      const value = params.get(key);
      if (value && /^\d+$/.test(value)) return value;
    }
    const html = document.documentElement ? document.documentElement.innerHTML : "";
    let match = html.match(/currentChildId\s*=\s*["'](\d+)["']/);
    if (match) return match[1];
    match = html.match(/child_id=(\d+)/);
    if (match) return match[1];
    match = html.match(/student_id=(\d+)/);
    if (match) return match[1];
    const link = $('a[href*="app/session/app.php?child_id="]');
    if (link) {
      match = String(link.getAttribute("href") || "").match(/child_id=(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function applyLanguage(languageId) {
    if (languageId == null || languageId === "") return;
    state.languageId = String(languageId);
    state.langCode = LANG_BY_ID[state.languageId] || "en";
  }

  /* ------------------------------------------------------------------- api */

  async function ensureContext() {
    if (!state.childId) state.childId = detectChildId();
    if (!state.childId) throw new Error("Brak child_id — zaloguj się i otwórz sesję.");
    if (!state.version) {
      state.version = parseVersion(document.documentElement ? document.documentElement.innerHTML : "");
      if (!state.version) {
        const url = ORIGIN + "/app/session/app.php?child_id=" + encodeURIComponent(state.childId);
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok) state.version = parseVersion(await response.text());
      }
      if (!state.version) throw new Error("Nie udało się pobrać parametru version z sesji.");
    }
    return { childId: state.childId, version: state.version };
  }

  async function api(name, options) {
    const opts = options || {};
    const method = opts.method || "POST";
    const url = new URL(ACTIONS + "/" + name + ".php");
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        url.searchParams.set(key, String(value));
      }
    }
    const init = {
      method,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    };
    if (method !== "GET" && opts.data) {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.data)) {
        body.set(key, String(value));
      }
      init.body = body.toString();
      init.headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
    const response = await fetch(url.toString(), init);
    if (!response.ok) throw new Error("HTTP " + response.status + " (" + name + ")");
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("Nie-JSON (" + name + "): " + text.slice(0, 120));
    }
  }

  async function ensureLanguage() {
    if (state.languageId) return state.languageId;
    const ctx = await ensureContext();
    const data = await api("init_session", {
      data: { child_id: ctx.childId, start: "", end: "" },
    });
    applyLanguage(data && data.language_id);
    return state.languageId;
  }

  async function audioAnswer(wordId) {
    try {
      const data = await api("getAudioUrl", { method: "GET", params: { id: wordId } });
      const url = data && data.url ? String(data.url) : "";
      if (!url) return null;
      let file = url.split("/").pop().split("?")[0];
      file = file.replace(/\.mp3$/i, "");
      if (!file || file === "undefined" || file === "_empty") return null;
      try {
        file = decodeURIComponent(file);
      } catch (_) {
        /* zostaw surową nazwę */
      }
      file = file.replace(/_/g, " ").trim();
      return file || null;
    } catch (_) {
      return null;
    }
  }

  function usableTranslation(value, source) {
    const text = plainText(value);
    if (!text) return false;
    const lower = text.toLowerCase();
    if (lower.includes("mymemory warning")) return false;
    if (lower.includes("query length limit")) return false;
    if (lower.includes("all available free translations")) return false;
    if (lower === "invalid") return false;
    if (text.length > 80) return false;
    if (lower === plainText(source).toLowerCase()) return false;
    if (/^[\[{]/.test(text)) return false;
    return true;
  }

  async function myMemoryAnswer(text, langCode) {
    try {
      const url =
        "https://api.mymemory.translated.net/get?q=" +
        encodeURIComponent(text) +
        "&langpair=" +
        encodeURIComponent("pl|" + langCode);
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) return null;
      const data = await response.json();
      const translated =
        data && data.responseData && data.responseData.translatedText
          ? data.responseData.translatedText
          : "";
      if (!usableTranslation(translated, text)) return null;
      return plainText(translated);
    } catch (_) {
      return null;
    }
  }

  async function googleAnswer(text, langCode) {
    try {
      const url =
        "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=pl&tl=" +
        encodeURIComponent(langCode) +
        "&dt=t&q=" +
        encodeURIComponent(text);
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) return null;
      const data = await response.json();
      const parts = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
      const translated = parts
        .map((part) => (Array.isArray(part) && part[0] ? String(part[0]) : ""))
        .join("")
        .trim();
      if (!usableTranslation(translated, text)) return null;
      return plainText(translated);
    } catch (_) {
      return null;
    }
  }

  async function resolveAnswer(word) {
    const id = String(word.id);
    const cached = dict.get(id);
    if (cached) return { answer: cached, source: "słownik" };

    const audio = await audioAnswer(id);
    if (audio) return { answer: audio, source: "audio" };

    const raw = plainText(word.translations);
    const first = raw.split(";")[0].trim();
    if (!first) return { answer: null, source: "brak" };

    const fromMyMemory = await myMemoryAnswer(first, state.langCode);
    if (fromMyMemory) return { answer: fromMyMemory, source: "MyMemory" };

    const fromGoogle = await googleAnswer(first, state.langCode);
    if (fromGoogle) return { answer: fromGoogle, source: "Google" };

    /* Ostatnia deska ratunku. Jeśli nauczyciel wymaga innego słowa, pierwsza
     * odpowiedź zostanie zapisana z save_answer.php i kolejna próba będzie
     * już bezbłędna (słownik). */
    return { answer: first, source: "raw" };
  }

  /* ---------------------------------------------------------------- słówka */

  function domText(selector) {
    const el = $(selector);
    return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function sameText(dom, api) {
    if (!dom || !api) return true;
    const a = dom.toLowerCase();
    const b = api.toLowerCase();
    if (a === b) return true;
    const aFirst = a.split(";")[0].trim();
    const bFirst = b.split(";")[0].trim();
    if (aFirst && aFirst === bFirst) return true;
    return a.includes(b) || b.includes(a);
  }

  function wordMatchesDom(word) {
    if (!word || !word.id) return false;
    if (!isVisible($("#learning_page"))) return true;
    /* Porównujemy tylko tłumaczenia — usage_example jest na stronie
     * uzupełniany ukrytym tekstem dla czytników ekranu (A11Y), więc nie
     * nadaje się do porównania 1:1.
     */
    return sameText(domText("#question_translation"), plainText(word.translations));
  }

  function pushWord(word) {
    if (!word || !word.id) return;
    const id = String(word.id);
    state.pendingWords = state.pendingWords.filter((item) => String(item.id) !== id);
    state.pendingWords.push(word);
    if (state.pendingWords.length > 8) state.pendingWords.shift();
  }

  async function acquireWord(timeout) {
    const limit = Date.now() + (timeout || 12000);
    while (Date.now() < limit) {
      while (state.pendingWords.length) {
        const word = state.pendingWords.shift();
        if (!word || !word.id) continue;
        if (String(word.id) === String(state.lastAnsweredId)) continue;
        if (!wordMatchesDom(word)) continue;
        return word;
      }
      await sleep(150);
    }
    return null;
  }

  async function fetchCurrentWord() {
    const ctx = await ensureContext();
    const word = await api("generate_next_word", {
      data: { child_id: ctx.childId, date: Date.now() },
    });
    if (word && word.id) pushWord(word);
    return word;
  }

  function waitForVisible(selector, timeout) {
    const limit = Date.now() + (timeout || 8000);
    return new Promise((resolve) => {
      const check = () => {
        const el = $(selector);
        if (isVisible(el)) return resolve(el);
        if (Date.now() >= limit) return resolve(null);
        setTimeout(check, 120);
      };
      check();
    });
  }

  /* ------------------------------------------------------------------- UI */

  function log(message) {
    const line = "[" + new Date().toLocaleTimeString() + "] " + message;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, 8);
    const box = $("#il-log");
    if (box) box.textContent = state.logs.join("\n");
    try {
      console.log("[InstaLing]", message);
    } catch (_) {
      /* ignore */
    }
  }

  function setStatus(text) {
    const el = $("#il-status");
    if (el) el.textContent = text;
  }

  function updateProgress() {
    const bar = $("#il-progress-bar");
    const wrap = $("#il-progress");
    if (!bar || !wrap) return;
    const active = state.autoOn || state.busy;
    wrap.classList.toggle("il-visible", active || state.progressPct >= 100);
    bar.style.width = Math.max(0, Math.min(100, state.progressPct)) + "%";
  }

  function setCount(value) {
    state.solved = value;
    const el = $("#il-count");
    if (el) el.textContent = String(value);
    if (state.progressPct < 100) {
      state.progressPct = Math.min(90, value * 4);
    }
    updateProgress();
  }

  function updateDictCount() {
    const el = $("#il-dict");
    if (el) el.textContent = dict.size() + " słów";
    if (state.dictPreviewOpen) renderDictPreview();
  }

  function renderDictPreview() {
    const box = $("#il-dict-preview");
    if (!box) return;
    const entries = Object.entries(dict.all()).slice(-40).reverse();
    box.textContent = entries.length
      ? entries.map(([id, word]) => id + " → " + word).join("\n")
      : "(słownik jest pusty — zapisze się po pierwszej odpowiedzi)";
    box.classList.toggle("il-visible", state.dictPreviewOpen);
  }

  function effectiveDelayMin() {
    return Math.max(1000, state.delayMax - DELAY_SPAN);
  }

  function readDelay() {
    try {
      const raw = Number(localStorage.getItem(DELAY_KEY));
      if (Number.isFinite(raw) && raw >= 1500 && raw <= 5000) return raw;
    } catch (_) {
      /* ignore */
    }
    return DEFAULT_DELAY_MAX;
  }

  function randDelay() {
    const min = effectiveDelayMin();
    const max = Math.max(min, state.delayMax);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function updateDelayLabel() {
    const el = $("#il-delay-val");
    if (el) {
      el.textContent = (effectiveDelayMin() / 1000).toFixed(1) + "–" + (state.delayMax / 1000).toFixed(1) + " s";
    }
  }

  function renderAccount() {
    const el = $("#il-account");
    if (!el) return;
    const cfg = user.get();
    el.textContent = cfg ? "👤 Konto: " + cfg.login : "👤 Konto: niezapisane";
  }

  function renderRunState() {
    const main = $("#il-main");
    if (main) {
      main.textContent =
        state.autoOn || state.busy
          ? "⏹ ZATRZYMAJ"
          : "🚀 ZRÓB DZISIEJSZĄ LEKCJĘ (AUTO)";
      main.classList.toggle("il-running", state.autoOn || state.busy);
    }
    updateProgress();
  }

  function openSettings(open) {
    state.settingsOpen = !!open;
    const panel = $("#il-settings");
    const toggle = $("#il-settings-toggle");
    if (panel) panel.classList.toggle("il-visible", state.settingsOpen);
    if (toggle) toggle.setAttribute("aria-expanded", state.settingsOpen ? "true" : "false");
    try {
      localStorage.setItem(SETTINGS_KEY, state.settingsOpen ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function setCollapsed(collapsed) {
    const root = $("#il-root");
    if (!root) return;
    root.classList.toggle("il-open", !collapsed);
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function bindPress(el, handler) {
    if (!el) return;
    let last = 0;
    const run = (event) => {
      const now = Date.now();
      if (now - last < 300) return;
      last = now;
      if (event && event.cancelable) event.preventDefault();
      handler(event);
    };
    el.addEventListener("click", run, { passive: false });
    el.addEventListener("touchend", run, { passive: false });
  }

  function showOverlay(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("il-visible", !!show);
    el.setAttribute("aria-hidden", show ? "false" : "true");
  }

  /* ------------------------------------------------------------- kreator UI */

  function showWizard() {
    const cfg = user.get();
    const loginInput = $("#il-w-login");
    const passInput = $("#il-w-pass");
    const autoInput = $("#il-w-auto");
    if (cfg && loginInput) loginInput.value = cfg.login;
    if (cfg && passInput) passInput.value = cfg.password;
    if (autoInput) autoInput.checked = !cfg || cfg.auto !== false;
    const error = $("#il-w-error");
    if (error) error.textContent = "";
    showOverlay("il-wizard", true);
    if (loginInput && !loginInput.value) {
      try {
        loginInput.focus();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function hideWizard() {
    showOverlay("il-wizard", false);
    try {
      sessionStorage.setItem(WIZARD_SKIP_KEY, "1");
    } catch (_) {
      /* ignore */
    }
  }

  async function saveWizard() {
    const loginInput = $("#il-w-login");
    const passInput = $("#il-w-pass");
    const autoInput = $("#il-w-auto");
    const error = $("#il-w-error");
    const login = loginInput ? loginInput.value.trim() : "";
    const password = passInput ? passInput.value : "";
    if (!login || !password) {
      if (error) error.textContent = "Wpisz login i hasło z karteczki.";
      return;
    }
    user.save(login, password, autoInput ? autoInput.checked : true);
    hideWizard();
    try {
      sessionStorage.removeItem("instaling_autologin_tried");
      sessionStorage.removeItem(NO_AUTOLOGIN_KEY);
    } catch (_) {
      /* ignore */
    }
    setStatus("Konto zapisane");
    log("Zapisano konto: " + login);

    if (isLoginPage()) {
      await fillAndSubmitLogin(user.get(), true);
      return;
    }
    if (isSessionPage() || isStudentPanel()) {
      log("Jesteś już zalogowany — konto zapisane na przyszłość");
      return;
    }
    location.href = ORIGIN + "/teacher.php?page=login";
  }

  function showAccountModal() {
    const cfg = user.get();
    const loginInput = $("#il-a-login");
    const passInput = $("#il-a-pass");
    const autoInput = $("#il-a-auto");
    const error = $("#il-a-error");
    if (loginInput) loginInput.value = cfg ? cfg.login : "";
    if (passInput) passInput.value = cfg ? cfg.password : "";
    if (autoInput) autoInput.checked = !cfg || cfg.auto !== false;
    if (error) error.textContent = "";
    showOverlay("il-account-modal", true);
    try {
      sessionStorage.setItem(NO_AUTOLOGIN_KEY, "1");
    } catch (_) {
      /* ignore */
    }
  }

  function saveAccountModal() {
    const loginInput = $("#il-a-login");
    const passInput = $("#il-a-pass");
    const autoInput = $("#il-a-auto");
    const error = $("#il-a-error");
    const login = loginInput ? loginInput.value.trim() : "";
    const password = passInput ? passInput.value : "";
    if (!login || !password) {
      if (error) error.textContent = "Wpisz login i hasło.";
      return;
    }
    user.save(login, password, autoInput ? autoInput.checked : true);
    showOverlay("il-account-modal", false);
    try {
      sessionStorage.removeItem(NO_AUTOLOGIN_KEY);
      sessionStorage.removeItem("instaling_autologin_tried");
    } catch (_) {
      /* ignore */
    }
    setStatus("Konto zapisane");
    log("Konto zmienione: " + login);
  }

  function submitLoginForm(form) {
    if (!form) return;
    try {
      HTMLFormElement.prototype.submit.call(form);
    } catch (_) {
      try {
        form.submit();
      } catch (__) {
        /* ignore */
      }
    }
  }

  async function fillAndSubmitLogin(cfg, submit) {
    if (!cfg) return false;
    const email = await waitForVisible("#log_email", 5000);
    const pass = $("#log_password");
    if (!email || !pass) return false;
    if (!email.value) setInput(email, cfg.login);
    if (!pass.value) setInput(pass, cfg.password);
    const form = email.closest("form") || $('form[action*="teacherActions"]');
    if (!form) return false;
    if (submit === false || cfg.auto === false) {
      setStatus("Wypełniono login — kliknij ZALOGUJ");
      return true;
    }
    setStatus("Logowanie…");
    log("Automatyczne logowanie: " + cfg.login);
    await sleep(500);
    const refreshed = user.get();
    if (!refreshed || refreshed.login !== cfg.login) return false;
    if (email.value !== cfg.login || pass.value !== cfg.password) {
      log("Pola logowania zmieniły się — nie loguję automatycznie");
      return false;
    }
    submitLoginForm(form);
    return true;
  }

  async function maybeAutoLogin() {
    const cfg = user.get();
    if (!cfg) return;
    if (document.getElementById("log_email") === null) {
      const email = await waitForVisible("#log_email", 2500);
      if (!email) return;
    }
    try {
      if (sessionStorage.getItem(NO_AUTOLOGIN_KEY) === "1") return;
    } catch (_) {
      /* ignore */
    }
    /* Zabezpieczenie przed pętlą: jedna automatyczna próba na kartę.
     * Jeśli po wysłaniu formularza znowu widzimy login, to znaczy, że dane
     * są błędne — wtedy nie próbujemy w kółko (ochrona przed blokadą konta).
     */
    try {
      if (sessionStorage.getItem("instaling_autologin_tried") === "1") {
        sessionStorage.setItem(NO_AUTOLOGIN_KEY, "1");
        log("Auto-login wstrzymany — sprawdź login/hasło w HUD");
        setStatus("Sprawdź dane logowania");
        return;
      }
      sessionStorage.setItem("instaling_autologin_tried", "1");
    } catch (_) {
      /* ignore */
    }
    await fillAndSubmitLogin(cfg, true);
  }

  function showSavePrompt(login, password, form) {
    state.pendingCredentials = { login, password };
    state.pendingForm = form;
    const who = $("#il-prompt-login");
    if (who) who.textContent = "Login: " + login;
    showOverlay("il-prompt", true);
  }

  function finishSavePrompt(remember) {
    const pending = state.pendingCredentials;
    const form = state.pendingForm;
    state.pendingCredentials = null;
    state.pendingForm = null;
    showOverlay("il-prompt", false);
    if (!pending) return;
    if (remember) {
      user.save(pending.login, pending.password, true);
      log("Zapamiętano konto: " + pending.login);
      setStatus("Konto zapamiętane");
    }
    submitLoginForm(form);
  }

  /* ---------------------------------------------------------- hooki strony */

  function installHooksFallback() {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.getURL) return;
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("hooks.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (_) {
      /* brak dostępu do zasobów rozszerzenia */
    }
  }

  function ensureHooks() {
    let alive = false;
    const onPong = () => {
      alive = true;
    };
    document.addEventListener("il:pong", onPong, { once: true });
    document.dispatchEvent(new CustomEvent("il:ping"));
    setTimeout(() => {
      document.removeEventListener("il:pong", onPong);
      if (!alive) installHooksFallback();
    }, 400);
  }

  document.addEventListener("il:api", (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.detail);
    } catch (_) {
      return;
    }
    if (!payload || !payload.name) return;
    const data = payload.data || {};

    if (payload.name === "init_session") {
      applyLanguage(data.language_id);
    }

    if (payload.name === "generate_next_word" && data.id) {
      pushWord(data);
      if (!state.autoOn) {
        setStatus("Słówko: " + plainText(data.translations));
      }
    }

    if (payload.name === "save_answer") {
      const id = data.__word_id || state.lastAnsweredId;
      const correct = data.word || data.answershow;
      if (id && correct) dict.set(id, correct);
    }
  });

  /* Przechwycenie ręcznego logowania — pytamy, czy zapamiętać konto. */
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!form || form.tagName !== "FORM") return;
      if (form.dataset && form.dataset.ilSubmitting === "1") return;
      const email = form.querySelector('input[name="log_email"], #log_email');
      const pass = form.querySelector('input[name="log_password"], #log_password');
      if (!email || !pass) return;
      const login = String(email.value || "").trim();
      const password = String(pass.value || "");
      if (!login || !password) return;
      const cfg = user.get();
      if (cfg && cfg.login === login && cfg.password === password) return;
      event.preventDefault();
      showSavePrompt(login, password, form);
    },
    true
  );

  /* --------------------------------------------------------------- solver */

  async function startAuto() {
    if (state.autoOn || state.busy) return;
    if (isLoginPage()) {
      const cfg = user.get();
      if (!cfg) {
        showWizard();
        return;
      }
      await fillAndSubmitLogin(cfg, true);
      return;
    }
    if (!isSessionPage()) {
      const link =
        $('a.btn-start-session[href*="app/session/app.php"]') ||
        $('a[href*="app/session/app.php"]');
      if (link) {
        try {
          sessionStorage.setItem(AUTOSTART_KEY, "1");
        } catch (_) {
          /* ignore */
        }
        location.href = link.href;
        return;
      }
      const child = detectChildId();
      if (child) {
        try {
          sessionStorage.setItem(AUTOSTART_KEY, "1");
        } catch (_) {
          /* ignore */
        }
        location.href = ORIGIN + "/app/session/app.php?child_id=" + encodeURIComponent(child);
        return;
      }
      setStatus("Otwórz stronę główną InstaLing");
      log("Nie znaleziono linku do sesji");
      return;
    }

    try {
      await ensureLanguage();
    } catch (err) {
      log("Nie udało się ustalić języka: " + (err && err.message ? err.message : err));
    }

    state.autoOn = true;
    state.cancelRequested = false;
    state.progressPct = 0;
    setCount(0);
    renderRunState();
    setStatus("Auto: start…");
    log("Start codziennej lekcji (opóźnienie " + (effectiveDelayMin() / 1000) + "–" + (state.delayMax / 1000) + " s)");
    if (!state.autoLoopActive) {
      state.autoLoopActive = true;
      autoLoop().finally(() => {
        state.autoLoopActive = false;
        state.autoOn = false;
        renderRunState();
      });
    }
  }

  function stopAuto(reason) {
    if (state.autoOn) {
      state.autoOn = false;
      log(reason || "Zatrzymano ręcznie");
      setStatus("Zatrzymano");
    }
    if (state.busy) state.cancelRequested = true;
    renderRunState();
  }

  async function autoLoop() {
    while (state.autoOn) {
      try {
        if (state.busy) {
          await sleep(500);
          continue;
        }
        await ensureContext();

        if (isVisible($("#start_session_button"))) {
          tap($("#start_session_button button") || $("#start_session_button"));
          log("Klik: rozpoczęcie sesji");
          await sleep(1000);
        } else if (isVisible($("#continue_session_button"))) {
          tap($("#continue_session_button button") || $("#continue_session_button"));
          log("Klik: kontynuacja sesji");
          await sleep(1000);
        }

        if (isVisible($("#finish_page"))) {
          state.autoOn = false;
          state.progressPct = 100;
          updateProgress();
          setStatus("✅ Sesja zakończona");
          log("Koniec sesji");
          break;
        }

        if (isVisible($("#possible_word_page"))) {
          tap($("#skip"));
          log("Pomijam dodatkowe słówko");
          await sleep(800);
          continue;
        }

        if (isVisible($("#new_word_form")) && isVisible($("#know_new"))) {
          tap($("#know_new"));
          log("Nowe słówko → Znam");
          await sleep(400);
        }

        let word = await acquireWord(4000);
        if (!word && isVisible($("#learning_page"))) {
          const fetched = await fetchCurrentWord();
          if (fetched && fetched.id && wordMatchesDom(fetched)) word = fetched;
        }

        if (!word || !word.id) {
          if (isVisible($("#finish_page"))) {
            state.autoOn = false;
            state.progressPct = 100;
            updateProgress();
            setStatus("✅ Sesja zakończona");
            break;
          }
          if (!isVisible($("#learning_page"))) {
            await sleep(1000);
            continue;
          }
          state.sameWordCount += 1;
          if (state.sameWordCount > 5) {
            throw new Error("Nie mogę dopasować słówka do strony — zatrzymano");
          }
          log("Czekam na nowe słówko…");
          await sleep(1000);
          continue;
        }
        state.sameWordCount = 0;

        const input = await waitForVisible("#answer", 8000);
        if (!input) {
          log("Brak pola #answer — czekam");
          await sleep(800);
          continue;
        }

        const resolved = await resolveAnswer(word);
        if (!resolved.answer) {
          log("Brak odpowiedzi dla " + word.id);
          setStatus("Brak odpowiedzi");
          stopAuto("Zatrzymano: brak odpowiedzi");
          break;
        }

        setInput(input, resolved.answer);
        setStatus("Wpisano: " + resolved.answer + " (" + resolved.source + ")");
        log("#" + word.id + " ← " + resolved.answer + " [" + resolved.source + "]");

        await sleep(randDelay());
        if (!state.autoOn) break;
        tap($("#check button") || $("#check"));

        const answerPage = await waitForVisible("#answer_page", 10000);
        if (!answerPage) {
          log("Brak #answer_page po sprawdzeniu");
          await sleep(800);
          continue;
        }
        await sleep(300);

        const correct = ($("#word") && $("#word").textContent ? $("#word").textContent : "").trim();
        const result = (
          $("#answer_result") && $("#answer_result").textContent ? $("#answer_result").textContent : ""
        ).trim();
        if (correct) dict.set(word.id, correct);
        state.lastAnsweredId = String(word.id);
        state.consecutiveErrors = 0;
        setCount(state.solved + 1);
        log("Wynik: " + (result || "?") + (correct ? " | " + correct : ""));

        /* Krótka pauza po wyniku; właściwe 3–5 s „na słówko” jest przed
         * kliknięciem „Sprawdź”. */
        await sleep(600 + Math.floor(Math.random() * 400));
        if (!state.autoOn) break;
        tap($("#nextword button") || $("#nextword"));
        await sleep(600);
      } catch (err) {
        state.consecutiveErrors += 1;
        log("Błąd (" + state.consecutiveErrors + "): " + (err && err.message ? err.message : String(err)));
        if (state.consecutiveErrors >= 10) {
          stopAuto("Zatrzymano po 10 błędach");
          log("Sprawdź log i odśwież stronę");
          break;
        }
        await sleep(1500);
      }
    }
    renderRunState();
    if (!state.autoOn && state.progressPct < 100) setStatus("Auto: OFF");
  }

  async function instantFinish(delayMs) {
    if (state.busy) return;
    state.busy = true;
    state.cancelRequested = false;
    state.progressPct = 0;
    setCount(0);
    renderRunState();
    if (state.autoOn) stopAuto("Przełączam na Instant Finish");
    setStatus("Instant Finish: start…");
    log("API solver start");

    try {
      const ctx = await ensureContext();
      const init = await api("init_session", {
        data: { child_id: ctx.childId, start: "", end: "" },
      });
      applyLanguage(init && init.language_id);

      let count = 0;
      let previous = null;
      let repeats = 0;

      for (let i = 0; i < 2000; i += 1) {
        if (state.cancelRequested) {
          log("Instant Finish: przerwano");
          break;
        }
        const word = await api("generate_next_word", {
          data: { child_id: ctx.childId, date: Date.now() },
        });
        if (!word || !word.id) {
          const summary = word && word.summary ? plainText(word.summary) : "";
          state.progressPct = 100;
          setStatus("✅ Sesja zakończona");
          log(summary ? "Summary: " + summary : "Brak kolejnych słówek");
          break;
        }

        const id = String(word.id);
        if (id === previous) repeats += 1;
        else repeats = 0;
        previous = id;
        if (repeats > 4) throw new Error("Serwer zwraca to samo słowo — przerwano");

        const resolved = await resolveAnswer(word);
        if (!resolved.answer) throw new Error("Brak odpowiedzi dla " + id);

        const response = await api("save_answer", {
          data: {
            child_id: ctx.childId,
            word_id: id,
            answer: resolved.answer,
            version: ctx.version,
          },
        });

        const correct = response && (response.word || response.answershow);
        dict.set(id, correct || resolved.answer);
        count += 1;
        setCount(count);
        setStatus("#" + count + " " + resolved.answer + " (" + resolved.source + ")");
        log(
          "#" + id + " " + resolved.answer + " [" + resolved.source + "] grade=" +
            (response && response.grade != null ? response.grade : "?")
        );
        await sleep(delayMs + Math.floor(Math.random() * 120));
      }
      log("Instant Finish: " + count + " słówek");
      updateProgress();
    } catch (err) {
      setStatus("Błąd");
      log("Instant Finish: " + (err && err.message ? err.message : String(err)));
    } finally {
      state.busy = false;
      state.cancelRequested = false;
      renderRunState();
    }
  }

  /* ------------------------------------------------------------------ HUD */

  function createHUD() {
    if ($("#il-root")) return;

    const root = document.createElement("div");
    root.id = "il-root";
    root.innerHTML = [
      '<button id="il-fab" type="button" aria-label="Otwórz panel InstaLing">IL</button>',
      '<section id="il-hud" role="dialog" aria-label="InstaLing HUD">',
      '  <header class="il-head">',
      '    <span class="il-title">InstaLing Bot</span>',
      '    <button id="il-collapse" class="il-icon" type="button" aria-label="Zwiń panel">−</button>',
      "  </header>",
      '  <div class="il-body">',
      '    <div class="il-account-row">',
      '      <span id="il-account">👤 Konto: —</span>',
      '      <button id="il-change" class="il-link" type="button">Zmień konto</button>',
      "    </div>",
      '    <div class="il-row il-status-row">',
      '      <span id="il-status">Gotowe</span>',
      '      <span class="il-badge">#<b id="il-count">0</b></span>',
      "    </div>",
      '    <div id="il-progress" class="il-progress"><div id="il-progress-bar"></div></div>',
      '    <button id="il-main" class="il-main" type="button">🚀 ZRÓB DZISIEJSZĄ LEKCJĘ (AUTO)</button>',
      '    <button id="il-settings-toggle" class="il-settings-toggle" type="button" aria-expanded="false">⚙️ Ustawienia</button>',
      '    <div id="il-settings" class="il-settings">',
      '      <label class="il-label" for="il-delay">Opóźnienie <span id="il-delay-val">3.0–5.0 s</span></label>',
      '      <input id="il-delay" class="il-range" type="range" min="1500" max="5000" step="250" value="5000">',
      '      <button id="il-finish" class="il-btn" type="button">⚡ Instant Finish (API, 1 s)</button>',
      '      <div class="il-row">',
      '        <button id="il-dict-toggle" class="il-btn il-ghost" type="button">📖 Podgląd słownika</button>',
      '        <span id="il-dict" class="il-muted">0 słów</span>',
      "      </div>",
      '      <pre id="il-dict-preview" class="il-dict-preview"></pre>',
      '      <button id="il-clear" class="il-btn il-ghost il-danger" type="button">🗑 Wyczyść słownik</button>',
      '      <button id="il-logout" class="il-btn il-ghost il-danger" type="button">🚪 Wyloguj / zmień konto</button>',
      "    </div>",
      '    <pre id="il-log" class="il-log"></pre>',
      "  </div>",
      "</section>",
      '<div id="il-wizard" class="il-overlay" aria-hidden="true">',
      '  <div class="il-modal">',
      '    <h2>👋 Skonfiguruj swoje konto Insta.Ling</h2>',
      '    <p class="il-note">Dane zostają tylko w tej przeglądarce (localStorage). Nic nie jest wysyłane na zewnątrz.</p>',
      '    <label class="il-field">Login ucznia (z karteczki)',
      '      <input id="il-w-login" type="text" autocomplete="username" placeholder="np. 13ab12345">',
      "    </label>",
      '    <label class="il-field">Hasło',
      '      <input id="il-w-pass" type="password" autocomplete="current-password" placeholder="hasło z karteczki">',
      "    </label>",
      '    <label class="il-check"><input id="il-w-auto" type="checkbox" checked> Automatycznie loguj i rozwiązuj po wejściu na stronę</label>',
      '    <p id="il-w-error" class="il-error"></p>',
      '    <button id="il-w-save" class="il-main" type="button">💾 ZAPISZ I ZALOGUJ</button>',
      '    <button id="il-w-skip" class="il-link" type="button">Pomiń — wpiszę dane później</button>',
      "  </div>",
      "</div>",
      '<div id="il-account-modal" class="il-overlay" aria-hidden="true">',
      '  <div class="il-modal">',
      "    <h2>👤 Zmień konto</h2>",
      '    <label class="il-field">Login ucznia',
      '      <input id="il-a-login" type="text" autocomplete="username">',
      "    </label>",
      '    <label class="il-field">Hasło',
      '      <input id="il-a-pass" type="password" autocomplete="current-password">',
      "    </label>",
      '    <label class="il-check"><input id="il-a-auto" type="checkbox" checked> Automatycznie loguj i rozwiązuj po wejściu na stronę</label>',
      '    <p id="il-a-error" class="il-error"></p>',
      '    <button id="il-a-save" class="il-main" type="button">💾 Zapisz konto</button>',
      '    <button id="il-a-cancel" class="il-btn" type="button">Anuluj</button>',
      "  </div>",
      "</div>",
      '<div id="il-prompt" class="il-overlay" aria-hidden="true">',
      '  <div class="il-modal">',
      "    <h2>Zapamiętać to konto?</h2>",
      "    <p>Zapamiętać to konto do automatycznego robienia lekcji?</p>",
      '    <p id="il-prompt-login" class="il-muted"></p>',
      '    <button id="il-prompt-yes" class="il-main" type="button">Tak, zapamiętaj i zaloguj</button>',
      '    <button id="il-prompt-no" class="il-btn" type="button">Nie, tylko zaloguj</button>',
      "  </div>",
      "</div>",
    ].join("");

    (document.body || document.documentElement).appendChild(root);

    state.delayMax = readDelay();
    const range = $("#il-delay");
    if (range) range.value = String(state.delayMax);
    updateDelayLabel();
    updateDictCount();
    renderAccount();
    updateProgress();
    renderRunState();
    const logBox = $("#il-log");
    if (logBox) logBox.textContent = state.logs.join("\n");

    let storedCollapsed = null;
    try {
      storedCollapsed = localStorage.getItem(COLLAPSE_KEY);
    } catch (_) {
      /* ignore */
    }
    const collapsed =
      storedCollapsed === null ? window.innerWidth < 600 : storedCollapsed === "1";
    setCollapsed(collapsed);

    try {
      state.settingsOpen = localStorage.getItem(SETTINGS_KEY) === "1";
    } catch (_) {
      state.settingsOpen = false;
    }
    openSettings(state.settingsOpen);

    bindPress($("#il-fab"), () => setCollapsed(false));
    bindPress($("#il-collapse"), () => setCollapsed(true));
    bindPress($("#il-main"), () => {
      if (state.autoOn || state.busy) {
        stopAuto("Zatrzymano ręcznie");
        return;
      }
      startAuto();
    });
    bindPress($("#il-settings-toggle"), () => openSettings(!state.settingsOpen));
    bindPress($("#il-finish"), () => instantFinish(1000));
    bindPress($("#il-change"), showAccountModal);
    bindPress($("#il-dict-toggle"), () => {
      state.dictPreviewOpen = !state.dictPreviewOpen;
      renderDictPreview();
    });
    bindPress($("#il-clear"), () => {
      dict.clear();
      log("Słownik wyczyszczony");
      renderDictPreview();
    });
    bindPress($("#il-logout"), () => {
      if (!window.confirm("Wylogować i usunąć zapisane konto z tej przeglądarki?")) return;
      user.clear();
      try {
        sessionStorage.removeItem(NO_AUTOLOGIN_KEY);
      } catch (_) {
        /* ignore */
      }
      location.href = ORIGIN + "/teacher2/logout.php";
    });

    bindPress($("#il-w-save"), saveWizard);
    bindPress($("#il-w-skip"), hideWizard);
    bindPress($("#il-a-save"), saveAccountModal);
    bindPress($("#il-a-cancel"), () => {
      showOverlay("il-account-modal", false);
      try {
        sessionStorage.removeItem(NO_AUTOLOGIN_KEY);
      } catch (_) {
        /* ignore */
      }
    });
    bindPress($("#il-prompt-yes"), () => finishSavePrompt(true));
    bindPress($("#il-prompt-no"), () => finishSavePrompt(false));

    const passInput = $("#il-w-pass");
    if (passInput) {
      passInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveWizard();
        }
      });
    }

    if (range) {
      range.addEventListener("input", () => {
        state.delayMax = Number(range.value) || DEFAULT_DELAY_MAX;
        try {
          localStorage.setItem(DELAY_KEY, String(state.delayMax));
        } catch (_) {
          /* ignore */
        }
        updateDelayLabel();
      });
    }
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    seedFromInstaller();
    createHUD();
    ensureHooks();
    if (!state.childId) state.childId = detectChildId();

    const cfg = user.get();
    const newcomer = !cfg;

    if (newcomer && !(isSessionPage() || isStudentPanel())) {
      let skipped = false;
      try {
        skipped = sessionStorage.getItem(WIZARD_SKIP_KEY) === "1";
      } catch (_) {
        skipped = false;
      }
      if (!skipped) showWizard();
    }

    if (isLoginPage()) {
      if (cfg) maybeAutoLogin();
      else log("Wpisz dane w kreatorze powyżej");
      return;
    }

    if (isSessionPage() || isStudentPanel()) {
      ensureContext()
        .then(() => log("child_id=" + state.childId + ", wersja=" + state.version))
        .catch((err) => log(err.message));

      let autostart = false;
      try {
        autostart = sessionStorage.getItem(AUTOSTART_KEY) === "1";
      } catch (_) {
        autostart = false;
      }
      if (autostart && isSessionPage()) {
        try {
          sessionStorage.removeItem(AUTOSTART_KEY);
        } catch (_) {
          /* ignore */
        }
        setTimeout(() => startAuto(), 900);
      } else if (!autostart && isSessionPage() && cfg && cfg.auto !== false) {
        /* Checkbox "Automatycznie loguj i rozwiązuj po wejściu na stronę". */
        log("Auto-start za chwilę — możesz zatrzymać w HUD");
        setTimeout(() => {
          if (!state.autoOn && !state.busy) startAuto();
        }, 1200);
      }
      return;
    }

    log("Otwórz stronę główną InstaLing lub zaloguj się");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
