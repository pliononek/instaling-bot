# InstaLing Bot

**Uniwersalny asystent ucznia dla [instaling.pl](https://instaling.pl)** — rozszerzenie Chrome/Edge (MV3) + userscript na iPhone'a i Androida.

Kreator konta w HUD, automatyczne logowanie, jedna lekcja jednym przyciskiem, uczący się słownik i kaskada tłumaczy. **Działa dla dowolnego ucznia** — w kodzie nie ma żadnego loginu, hasła ani `child_id`.

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-38bdf8.svg)](wtyczka/manifest.json)
[![Wersja](https://img.shields.io/badge/wersja-2.0.0-a855f7.svg)](wtyczka/manifest.json)
[![Bez kont w kodzie](https://img.shields.io/badge/dane%20konta-tylko%20lokalnie-fbbf24.svg)](#bezpieczeństwo-i-prywatność)

> **Nie chcesz klonować repozytorium?** Pobierz gotową paczkę z [najnowszego wydania](https://github.com/pliononek/instaling-bot/releases/latest) — zawiera te same pliki w folderze `InstaLing-Uniwersalny/`.

---

## ⚠️ Zanim zainstalujesz

> **Regulamin InstaLing zabrania automatyzacji sesji** — w tym skryptów, wtyczek i automatycznych tłumaczy.
> To narzędzie omija tę zasadę i może skończyć się **blokadą konta**. Używasz świadomie i na własną odpowiedzialność.
> Hasło jest przechowywane **jawnie** w `localStorage` przeglądarki (lub w `config.js` po instalatorze) — nie instaluj tego na współdzielonym komputerze.

---

## Spis treści

- [Funkcje](#funkcje)
- [Instalacja — Windows](#-instalacja--windows)
- [Instalacja — Linux / macOS](#-instalacja--linux--macos)
- [Instalacja — Android](#-instalacja--android)
- [Instalacja — iPhone / iPad](#-instalacja--iphone--ipad)
- [Używanie HUD](#używanie-hud)
- [Jak to działa](#jak-to-działa)
- [Klient CLI](#klient-cli-opcjonalny)
- [Budowanie userscriptu](#budowanie-userscriptu)
- [Struktura repozytorium](#struktura-repozytorium)
- [Rozwiązywanie problemów](#rozwiązywanie-problemów)
- [Bezpieczeństwo i prywatność](#bezpieczeństwo-i-prywatność)
- [Współtwórcy](#współtwórcy)
- [Licencja](#licencja)

---

## Funkcje

| | |
|---|---|
| 👋 **Kreator konta w HUD** | Przy pierwszym wejściu wtyczka pyta o login i hasło z karteczki. Zapisuje je tylko lokalnie — nic nie jest zahardkodowane. |
| 🔐 **Auto-logowanie** | Zapisane konto wypełnia formularz i loguje w ~0,5 s. Ręczne logowanie jest przechwytywane pytaniem *„Zapamiętać to konto?”*. |
| 🚀 **Jedna lekcja, jeden przycisk** | Zielony przycisk robi całą sesję: start → odpowiedzi → „Następne” → koniec. Domyślnie 3–5 s na słówko. |
| 📊 **Pasek postępu** | Rośnie z każdym rozwiązanym słówkiem i dobija do 100% na końcu sesji. |
| 🧠 **Uczący się słownik** | Po `save_answer.php` dokładna odpowiedź nauczyciela (`word` / `answershow`) trafia do `localStorage`. Powtórka = zero błędów. |
| 🌍 **Kaskada tłumaczy** | Słownik → plik MP3 → MyMemory → Google → surowe tłumaczenie. Język z `language_id` (1=en, 2=de, 3=es, 4=fr). |
| ⚡ **Instant Finish** | Tryb API (1 s na słówko) ukryty w `⚙️ Ustawieniach`, z możliwością przerwania. |
| 📱 **Mobile-first** | Osobny FAB „IL”, poprawki `safe-area` (Dynamic Island, pasek gestów), duże cele dotykowe. |
| 🔄 **Zero hardkodu** | `child_id` z URL-a / DOM, `version` z `updateParams(...)` w źródle sesji. |

---

## 💻 Instalacja — Windows

1. Pobierz repozytorium (**Code → Download ZIP**) i rozpakuj, albo sklonuj:

   ```powershell
   git clone https://github.com/pliononek/instaling-bot.git
   ```

2. Kliknij dwukrotnie **`INSTALUJ_WINDOWS.bat`**.

   Instalator:
   - pyta (opcjonalnie) o login i hasło — jeśli je podasz, zapisze je od razu do `config.js` wtyczki;
   - kopiuje wtyczkę do `%LOCALAPPDATA%\InstaLingBot\extension`;
   - wkłada tę ścieżkę do schowka (`clip`);
   - otwiera `START_INSTRUKCJA.html` oraz `chrome://extensions`.

3. W przeglądarce:
   1. Włącz **Tryb dewelopera** (*Developer mode*).
   2. Kliknij **Załaduj rozpakowane** (*Load unpacked*).
   3. W oknie wyboru folderu wciśnij **Ctrl+V** i zatwierdź.

4. Odśwież **instaling.pl**. Jeśli nie podałeś danych w konsoli, pojawi się kreator konta.

> Bez instalatora: `chrome://extensions` → *Załaduj rozpakowane* → wskaż folder **`wtyczka/`** z tego repozytorium.

---

## 🐧 Instalacja — Linux / macOS

```bash
git clone https://github.com/pliononek/instaling-bot.git
cd instaling-bot
bash INSTALUJ_LINUX.sh
```

Skrypt kopiuje wtyczkę do `~/.local/share/InstaLingBot/extension`, opcjonalnie zapisuje dane do `config.js`, kopiuje ścieżkę do schowka (`wl-copy` / `xclip` / `xsel`) i otwiera instrukcję.

Potem w Chrome / Chromium / Edge / Brave:

1. `chrome://extensions` → **Tryb dewelopera**
2. **Załaduj rozpakowane** → wybierz `~/.local/share/InstaLingBot/extension`
3. Odśwież `instaling.pl`

> macOS: ta sama ścieżka (`~/.local/share/...`). Safari nie obsługuje wtyczek Chrome — użyj wersji userscript (poniżej).

---

## 🤖 Instalacja — Android

1. Zainstaluj **Tampermonkey** lub **Violentmonkey** (Play Store).
2. Otwórz menedżer → **+** → *Utwórz nowy skrypt*.
3. Usuń szablon i wklej **całą** zawartość pliku [`instaling-mobile.user.js`](instaling-mobile.user.js).
4. Zapisz i upewnij się, że skrypt jest **włączony**.
5. Wejdź na `instaling.pl` w Chrome/Firefoxie.

Pojawi się kreator konta, a po zapisaniu — HUD z zielonym przyciskiem lekcji i FAB-em „IL”.

---

## 🍏 Instalacja — iPhone / iPad

1. Zainstaluj z App Store **Userscripts** (albo **Stay for Safari**).
2. W aplikacji utwórz nowy skrypt i wklej zawartość [`instaling-mobile.user.js`](instaling-mobile.user.js).
3. **Ustawienia → Safari → Rozszerzenia** → włącz dodatek i zezwól mu na `instaling.pl`.
4. Otwórz `instaling.pl` w Safari, zaloguj się / zapisz konto w kreatorze HUD.
5. FAB „IL” unosi się nad dolną krawędzią ekranu (z uwzględnieniem safe-area).

> Na iPhonie nie da się instalować wtyczek Chrome — userscript to ta sama logika w jednym pliku.

---

## Używanie HUD

Po wejściu na `instaling.pl` w prawym dolnym rogu pojawia się przycisk **„IL”**. Kliknij go, aby rozwinąć panel („−” zwija).

### Pierwsze uruchomienie

```
👋 Skonfiguruj swoje konto Insta.Ling
┌────────────────────────────────────────────┐
│ Login ucznia (z karteczki)  [___________]  │
│ Hasło                       [___________]  │
│ ☑ Automatycznie loguj i rozwiązuj           │
│                 💾 ZAPISZ I ZALOGUJ         │
└────────────────────────────────────────────┘
```

Dane trafiają wyłącznie do `localStorage` tej przeglądarki.

### Panel główny

| Element | Działanie |
|---|---|
| `👤 Konto: [login]` + *Zmień konto* | Podmiana loginu/hasła bez grzebania w plikach. |
| `🚀 ZRÓB DZISIEJSZĄ LEKCJĘ (AUTO)` | Wchodzi w sesję, klika start/kontynuację i rozwiązuje słówka. Na stronie logowania najpierw loguje zapisane konto. |
| `⏹ ZATRZYMAJ` | Pojawia się w miejscu zielonego przycisku podczas pracy. Przerywa auto lub Instant Finish. |
| Pasek postępu | Rośnie z liczbą odpowiedzi (do 90%), 100% na końcu sesji. |
| `⚙️ Ustawienia` | Suwak opóźnienia, Instant Finish (API, 1 s), podgląd i czyszczenie słownika, wylogowanie. |

### Ustawienia (zaawansowane)

- **Suwak opóźnienia** — 1,0–5,0 s; domyślnie 3,0–5,0 s (bezpieczne dla nauczyciela tempo).
- **⚡ Instant Finish (API, 1 s)** — pomija UI i wysyła odpowiedzi bezpośrednio do API. Szybkie, ale widoczne w statystykach czasu.
- **📖 Podgląd słownika** — mapa `word_id → poprawna odpowiedź`.
- **🗑 Wyczyść słownik** — usuwa całą nauczoną pamięć.
- **🚪 Wyloguj / zmień konto** — czyści zapisane konto i wylogowuje z serwisu.

---

## Jak to działa

### Przepływ

```
                    ┌──────────────────────────┐
  instaling.pl ───► │  hooks.js (MAIN world)   │  przechwytuje XHR/fetch
                    │  il:api → CustomEvent    │  endpointów sesji
                    └────────────┬─────────────┘
                                 │ JSON (string)
                    ┌────────────▼─────────────┐
                    │ content.js (isolated)    │  HUD, kreator, auto-login,
                    │  stan + solver + słownik │  kaskada tłumaczy
                    └────────────┬─────────────┘
                                 │ fetch (same-origin)
                    ┌────────────▼─────────────┐
                    │ /app/session/server/     │  init_session,
                    │ actions/*.php            │  generate_next_word,
                    └──────────────────────────┘  save_answer, getAudioUrl
```

Wtyczka działa w dwóch światach: `hooks.js` siedzi w kontekście strony (`world: "MAIN"`, `document_start`) i podsłuchuje odpowiedzi serwera, a `content.js` w izolowanym świecie buduje interfejs i rozmawia z API. Userscript łączy oba pliki w jeden skrypt.

### Dynamiczne `child_id` i `version`

Nic nie jest wpisane na stałe:

- **`child_id`** — kolejno z: parametru URL (`child_id`, `student_id`, `id`) → `currentChildId = "…"` w źródle strony → linku `app/session/app.php?child_id=…`.
- **`version`** — z wywołania `updateParams(..., "32-znakowy-hex")` w HTML widoku sesji (jeśli brak, strona jest dociągana ponownie przez `fetch`).

### Endpointy

| Endpoint | Payload |
|---|---|
| `init_session.php` | `child_id`, `start`, `end` → m.in. `language_id` |
| `generate_next_word.php` | `child_id`, `date` (epoch ms) |
| `save_answer.php` | `child_id`, `word_id`, `answer`, `version` → `grade`, `word`, `answershow` |
| `getAudioUrl.php` | `?id=word_id` → `url` pliku MP3 |

> `generate_next_word.php` zwraca **to samo słowo**, dopóki nie zostanie zapisana odpowiedź. Dlatego solver zawsze odpowiada przed pobraniem kolejnego.

### Kaskada odpowiedzi

```
1. localStorage["instaling_dict"][word_id]     ← najszybsze, w 100% zgodne z nauczycielem
2. nazwa pliku z getAudioUrl.php               ← np. .../wipe.mp3 → "wipe"
3. MyMemory  api.mymemory.translated.net
4. Google    translate.googleapis.com (client=dict-chrome-ex)
5. surowe pierwsze tłumaczenie z API
```

Każdy wynik jest filtrowany (odrzucane są m.in. `MYMEMORY WARNING`, limity, HTML, odpowiedzi > 80 znaków, echo źródła).

### Język docelowy

`init_session.php` zwraca `language_id`, które mapujemy na kod tłumacza:

| `language_id` | język | kod |
|---|---|---|
| 1 | angielski | `en` |
| 2 | niemiecki | `de` |
| 3 | hiszpański | `es` |
| 4 | francuski | `fr` |

### Uczący się słownik

Po każdej odpowiedzi wtyczka bierze **dokładne** `word` / `answershow` z odpowiedzi `save_answer.php` i zapisuje je pod `word_id`. Gdy to samo słówko wróci w tej samej sesji (albo następnego dnia), odpowiedź jest już bezbłędna — niezależnie od tego, czy tłumacz się pomylił.

### Klucze w `localStorage`

| Klucz | Zawartość |
|---|---|
| `instaling_user` | `{login, password, auto, savedAt}` |
| `instaling_dict` | `{ "word_id": "poprawna odpowiedź" }` |
| `instaling_delay_v2` | maksymalne opóźnienie w ms (1000–5000) |
| `instaling_hud_collapsed` | stan zwinięcia panelu |
| `instaling_settings_open` | stan rozwinięcia Ustawień |

Dodatkowo `sessionStorage` trzyma flagi jednorazowe (auto-start po przejściu do sesji, blokada pętli auto-logowania, pominięcie kreatora).

---

## Klient CLI (opcjonalny)

[`instaling_client.py`](instaling_client.py) to uniwersalny klient sesji — przydatny do testów i diagnostyki. **Nie zawiera żadnych danych logowania.**

```bash
pip install "scrapling[fetchers]"

# dane przez argumenty…
python3 instaling_client.py --login TWOJ_LOGIN --password TWOJE_HASLO --info

# …albo przez zmienne środowiskowe
export INSTALING_LOGIN=TWOJ_LOGIN
export INSTALING_PASSWORD=TWOJE_HASLO

python3 instaling_client.py --solve            # rozwiąż całą sesję
python3 instaling_client.py --next             # bieżące słówko
python3 instaling_client.py --audio 136151     # URL nagrania
python3 instaling_client.py --grade --json     # raport oceny
```

Słownik `word_id → odpowiedź` jest zapisywany w `~/.instaling_dict.json` (zmiana: `--dict-path`).

---

## Budowanie userscriptu

Po zmianach w `wtyczka/*.js` i `wtyczka/styles.css` przegeneruj userscript:

```bash
python3 build_userscript.py
node --check instaling-mobile.user.js   # walidacja składni
```

Skrypt skleja nagłówek `==UserScript==`, style, `hooks.js` i `content.js` w jeden plik.

---

## Struktura repozytorium

```
instaling-bot/
├── wtyczka/                    # rozszerzenie Chrome/Edge (MV3)
│   ├── manifest.json
│   ├── config.js               # seed z instalatora (puste domyślnie)
│   ├── content.js              # HUD, kreator, auto-login, solver
│   ├── hooks.js                # przechwytywanie XHR/fetch (MAIN world)
│   └── styles.css              # HUD, modal, FAB, mobile
├── instaling-mobile.user.js    # gotowy userscript (Android / iPhone)
├── INSTALUJ_WINDOWS.bat        # instalator Windows
├── INSTALUJ_LINUX.sh           # instalator Linux/macOS
├── START_INSTRUKCJA.html       # ilustrowana instrukcja
├── instaling_client.py         # uniwersalny klient CLI
├── build_userscript.py         # generator userscriptu
├── CONTRIBUTORS.md
├── LICENSE                     # MIT
└── README.md
```

---

## Rozwiązywanie problemów

<details>
<summary><strong>Nie widzę HUD / kreatora</strong></summary>

Odśwież stronę (F5). Sprawdź, czy rozszerzenie jest włączone w `chrome://extensions` i czy działa na `*.instaling.pl`. Na telefonie upewnij się, że skrypt jest aktywny w Tampermonkey / Userscripts. Po edycji plików wtyczki kliknij **Odśwież** na karcie rozszerzenia.
</details>

<details>
<summary><strong>„Brak child_id” / „Nie udało się pobrać version”</strong></summary>

Zaloguj się i wejdź na stronę główną ucznia albo bezpośrednio w sesję (`/app/session/app.php?child_id=...`). Sesja PHP wygasa — wyloguj się i zaloguj ponownie.
</details>

<details>
<summary><strong>Auto-logowanie nie działa / wstrzymane</strong></summary>

Wtyczka wykonuje **jedną** automatyczną próbę na kartę, żeby nie zablokować konta przy błędnym haśle. Otwórz HUD → *Zmień konto* i popraw dane (to resetuje blokadę).
</details>

<details>
<summary><strong>Tłumacz zwraca bzdury</strong></summary>

To normalne przy trudnych słowach. Pierwsza odpowiedź zostanie zapisana z serwera, więc kolejne wystąpienie pójdzie już ze słownika. Możesz też ręcznie podejrzeć/wyczyścić słownik w Ustawieniach.
</details>

<details>
<summary><strong>Google Translate zwraca HTTP 429</strong></summary>

Limit darmowego endpointu z danego IP. Kaskada automatycznie przechodzi dalej (MyMemory albo surowe tłumaczenie). Odczekaj lub użyj innej sieci.
</details>

<details>
<summary><strong>Jak odinstalować?</strong></summary>

Usuń rozszerzenie z `chrome://extensions` (albo skrypt z Tampermonkey / Userscripts). Opcjonalnie wyczyść `instaling_user` i `instaling_dict` w DevTools → Application → Local Storage.
</details>

---

## Bezpieczeństwo i prywatność

- **Brak telemetrii.** Wtyczka nie wysyła nigdzie danych poza zapytania do InstaLing i publicznych API tłumaczy.
- **Dane logowania zostają lokalnie** — `localStorage` przeglądarki lub `config.js` w folderze rozszerzenia.
- **Hasło jest jawne** (bez szyfrowania) — tak samo jak w każdym innym menedżerze haseł w przeglądarce, ale bez master-hasła.
- **Nie instaluj na komputerze współdzielonym** i nie commituj `config.js` z wpisanymi danymi.
- Uprawnienia rozszerzenia: `*://*.instaling.pl/*`, `api.mymemory.translated.net`, `translate.googleapis.com`.

---

## Współtwórcy

Zobacz [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

- **pliononek** — pomysł, testy, dopracowanie UX
- **DeepSeek** — architektura, implementacja, dokumentacja
- **OpenCode** — środowisko agentowe, refaktoryzacja, testy, publikacja

---

## Licencja

[MIT](LICENSE) © 2026 pliononek and contributors.

Projekt nie jest powiązany z InstaLing. Wszystkie znaki towarowe należą do ich właścicieli.
