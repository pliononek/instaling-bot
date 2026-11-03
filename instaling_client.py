#!/usr/bin/env python3
"""Uniwersalny klient sesji nauki InstaLing (dowolne konto ucznia).

Dane logowania NIE są zapisane w kodzie. Podaj je przez argumenty, zmienne
środowiskowe albo wpisz interaktywnie:

    python instaling_client.py --login 13ab12345 --password haslo --solve
    INSTALING_LOGIN=... INSTALING_PASSWORD=... python instaling_client.py --solve

Logowanie odbywa się przez formularz `teacher.php?page=teacherActions`,
`child_id` jest wykrywany z przekierowania, a `version` z kodu widoku sesji.
Język docelowy tłumacza wynika z `language_id` zwracanego przez
`init_session.php` (1=en, 2=de, 3=es, 4=fr).

Pozostałe tryby:
    python instaling_client.py --info
    python instaling_client.py --next
    python instaling_client.py --answer 136151 flannel
    python instaling_client.py --grade --json
    python instaling_client.py --audio 136151

Słownik `word_id -> poprawna odpowiedź` jest zapisywany w
`~/.instaling_dict.json` (można zmienić przez --dict-path).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from scrapling.fetchers import FetcherSession

BASE_URL = "https://instaling.pl"
LOGIN_PAGE = f"{BASE_URL}/teacher.php?page=login"
LOGIN_ACTION = f"{BASE_URL}/teacher.php?page=teacherActions"
PANEL_URL = f"{BASE_URL}/student/pages/mainPage.php"
SESSION_URL = f"{BASE_URL}/app/session/app.php"

LANGUAGE_CODES = {1: "en", 2: "de", 3: "es", 4: "fr"}
DEFAULT_DICT_PATH = Path.home() / ".instaling_dict.json"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)


class InstaLingError(RuntimeError):
    """Błąd logowania lub nieoczekiwana odpowiedź serwera."""


def _strip_html(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"<[^>]*>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_dict(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_dict(path: Path, data: dict[str, str]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def _get_json(url: str, timeout: float = 15.0) -> Any:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8", "replace"))


def _usable_translation(value: Any, source: str) -> bool:
    text = _strip_html(value)
    if not text:
        return False
    lower = text.lower()
    if "mymemory warning" in lower or "query length limit" in lower:
        return False
    if "all available free translations" in lower:
        return False
    if lower in {"invalid", "none"}:
        return False
    if text.startswith("[") or text.startswith("{"):
        return False
    if len(text) > 80:
        return False
    if lower == _strip_html(source).lower():
        return False
    return True


def mymemory_translate(text: str, lang_code: str) -> str | None:
    query = urllib.parse.urlencode({"q": text, "langpair": f"pl|{lang_code}"})
    try:
        data = _get_json(f"https://api.mymemory.translated.net/get?{query}")
    except Exception:  # noqa: BLE001 - sieć bywa zawodna
        return None
    translated = (data.get("responseData") or {}).get("translatedText") if isinstance(data, dict) else None
    return _strip_html(translated) if _usable_translation(translated, text) else None


def google_translate(text: str, lang_code: str) -> str | None:
    query = urllib.parse.urlencode(
        {
            "client": "dict-chrome-ex",
            "sl": "pl",
            "tl": lang_code,
            "dt": "t",
            "q": text,
        }
    )
    try:
        data = _get_json(f"https://translate.googleapis.com/translate_a/single?{query}")
    except Exception:  # noqa: BLE001
        return None
    parts = data[0] if isinstance(data, list) and data and isinstance(data[0], list) else []
    translated = "".join(
        str(part[0]) for part in parts if isinstance(part, list) and part and part[0]
    ).strip()
    return _strip_html(translated) if _usable_translation(translated, text) else None


class InstaLingClient:
    """Minimalny, synchroniczny klient HTTP dla konta ucznia InstaLing."""

    def __init__(
        self,
        login: str,
        password: str,
        child_id: int | None = None,
        timeout: float = 30.0,
        dict_path: Path | None = None,
    ) -> None:
        self.login = login
        self.password = password
        self.child_id = child_id
        self.timeout = timeout
        self.session_url: str | None = None
        self.version: str | None = None
        self.language_id: str | None = None
        self.language_code = "en"
        self.dict_path = dict_path or DEFAULT_DICT_PATH
        self._factory = FetcherSession(
            impersonate="chrome",
            timeout=timeout,
            follow_redirects=True,
        )
        self._http = None

    # ------------------------------------------------------------------ setup
    def __enter__(self) -> "InstaLingClient":
        if not self.login or not self.password:
            raise InstaLingError("Brak loginu lub hasła — podaj je przez --login/--password.")
        self._http = self._factory.__enter__()
        self.authenticate()
        self.open_session_page()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._factory.__exit__(exc_type, exc, tb)

    def _require_http(self):
        if self._http is None:
            raise InstaLingError("Klient nie jest otwarty — użyj 'with InstaLingClient(...) as c:'.")
        return self._http

    def _headers(self) -> dict[str, str]:
        return {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": self.session_url or f"{SESSION_URL}?child_id={self.child_id}",
        }

    @staticmethod
    def _check(response, expected: int = 200) -> Any:
        if response.status != expected:
            raise InstaLingError(f"HTTP {response.status} dla {response.url}")
        return response

    def _json(self, response) -> dict[str, Any]:
        self._check(response)
        try:
            return response.json()
        except Exception as exc:  # noqa: BLE001 - komunikat serwera bywa nie-JSON
            body = response.body.decode(response.encoding or "utf-8", "replace")
            raise InstaLingError(f"Odpowiedź nie jest JSON: {body[:300]!r}") from exc

    # ------------------------------------------------------------------ auth
    def authenticate(self) -> int:
        """Wysyła formularz logowania i zwraca `child_id` (student_id)."""
        http = self._require_http()
        response = http.post(
            LOGIN_ACTION,
            data={
                "action": "login",
                "from": "",
                "is_quick": "",
                "log_email": self.login,
                "log_password": self.password,
            },
            headers={"Referer": LOGIN_PAGE, "Origin": BASE_URL},
        )
        self._check(response)

        match = re.search(r"student_id=(\d+)", response.url)
        if not match:
            raise InstaLingError(
                "Logowanie nie przekierowało do panelu ucznia — sprawdź dane dostępowe. "
                f"Ostatni URL: {response.url}"
            )
        self.child_id = int(match.group(1))
        return self.child_id

    def open_session_page(self) -> dict[str, Any]:
        """Pobiera panel, odnajduje link sesji i wyciąga stałą `version` z JS."""
        http = self._require_http()
        panel_url = f"{PANEL_URL}?student_id={self.child_id}"
        panel = self._check(http.get(panel_url))

        link = panel.css('a.btn-start-session::attr(href)').get()
        if not link:
            raise InstaLingError("Nie znaleziono przycisku 'Rozpocznij codzienną sesję'.")
        self.session_url = urllib.parse.urljoin(BASE_URL, link)

        page = self._check(http.get(self.session_url))
        version = re.search(r"updateParams\([^;]*?['\"]([0-9A-Fa-f]{32})['\"]", page.html_content)
        if not version:
            raise InstaLingError("Nie znaleziono stałej `version` w kodzie sesji.")
        self.version = version.group(1)
        return {
            "child_id": self.child_id,
            "session_url": self.session_url,
            "version": self.version,
        }

    # -------------------------------------------------------------- endpoints
    def init_session(self, start: str = "", end: str = "") -> dict[str, Any]:
        response = self._require_http().post(
            f"{BASE_URL}/app/session/server/actions/init_session.php",
            data={"child_id": str(self.child_id), "start": start, "end": end},
            headers=self._headers(),
        )
        data = self._json(response)
        language_id = data.get("language_id")
        if language_id is not None:
            self.language_id = str(language_id)
            try:
                self.language_code = LANGUAGE_CODES.get(int(language_id), "en")
            except (TypeError, ValueError):
                self.language_code = "en"
        return data

    def next_word(self) -> dict[str, Any]:
        response = self._require_http().post(
            f"{BASE_URL}/app/session/server/actions/generate_next_word.php",
            data={"child_id": str(self.child_id), "date": str(_now_ms())},
            headers=self._headers(),
        )
        return self._json(response)

    def save_answer(self, word_id: int | str, answer: str) -> dict[str, Any]:
        if not self.version:
            raise InstaLingError("Brak stałej `version` — najpierw otwórz widok sesji.")
        response = self._require_http().post(
            f"{BASE_URL}/app/session/server/actions/save_answer.php",
            data={
                "child_id": str(self.child_id),
                "word_id": str(word_id),
                "answer": answer,
                "version": self.version,
            },
            headers=self._headers(),
        )
        return self._json(response)

    def audio_url(self, word_id: int | str) -> str:
        response = self._require_http().get(
            f"{BASE_URL}/app/session/server/actions/getAudioUrl.php",
            params={"id": str(word_id)},
            headers=self._headers(),
        )
        return self._json(response)["url"]

    def audio_answer(self, word_id: int | str) -> str | None:
        try:
            url = self.audio_url(word_id)
        except (InstaLingError, KeyError):
            return None
        name = str(url).split("/")[-1].split("?")[0]
        if name.lower().endswith(".mp3"):
            name = name[:-4]
        if not name or name in {"_empty", "undefined"}:
            return None
        name = urllib.parse.unquote(name).replace("_", " ").strip()
        return name or None

    def resolve_answer(self, word: dict[str, Any]) -> tuple[str | None, str]:
        word_id = str(word.get("id", ""))
        dictionary = load_dict(self.dict_path)
        if dictionary.get(word_id):
            return dictionary[word_id], "dict"

        audio = self.audio_answer(word_id)
        if audio:
            return audio, "audio"

        translations = _strip_html(word.get("translations"))
        first = translations.split(";")[0].strip()
        if not first:
            return None, "brak"

        translated = mymemory_translate(first, self.language_code)
        if translated:
            return translated, "mymemory"
        translated = google_translate(first, self.language_code)
        if translated:
            return translated, "google"
        return first, "raw"

    def remember(self, word_id: int | str, word: str) -> None:
        if not word_id or not word:
            return
        dictionary = load_dict(self.dict_path)
        dictionary[str(word_id)] = str(word).strip()
        save_dict(self.dict_path, dictionary)

    def solve_session(
        self,
        delay: float = 3.0,
        max_words: int = 200,
        verbose: bool = True,
    ) -> dict[str, Any]:
        """Rozwiązuje całą sesję: init -> next -> answer -> ... -> summary."""
        init = self.init_session()
        solved = 0
        previous: str | None = None
        repeats = 0

        for _ in range(max_words):
            word = self.next_word()
            if "id" not in word:
                summary = _strip_html(word.get("summary", ""))
                if verbose:
                    print(f"Koniec sesji po {solved} słówkach. {summary}".strip())
                return {"solved": solved, "summary": summary}

            word_id = str(word["id"])
            if word_id == previous:
                repeats += 1
            else:
                repeats = 0
            previous = word_id
            if repeats > 4:
                raise InstaLingError("Serwer zwraca to samo słowo — przerwano.")

            answer, source = self.resolve_answer(word)
            if not answer:
                raise InstaLingError(f"Brak odpowiedzi dla słówka {word_id}.")
            response = self.save_answer(word_id, answer)
            correct = response.get("word") or response.get("answershow")
            if correct:
                self.remember(word_id, correct)
            solved += 1
            if verbose:
                grade = response.get("grade", "?")
                print(f"[{solved}] {word_id} -> {answer} ({source}), grade={grade}")
            if delay:
                time.sleep(delay)

        raise InstaLingError(f"Przekroczono limit {max_words} słówek.")

    def save_comment(self, word_id: int | str, comment: str) -> dict[str, Any]:
        response = self._require_http().post(
            f"{BASE_URL}/app/session/server/actions/save_comment.php",
            data={
                "child_id": str(self.child_id),
                "word_id": str(word_id),
                "comment": comment,
            },
            headers=self._headers(),
        )
        return self._json(response)

    def grade_report(self) -> dict[str, Any]:
        response = self._require_http().post(
            f"{BASE_URL}/app/session/server/actions/grade_report.php",
            data={"child_id": str(self.child_id), "date": str(_now_ms())},
            headers=self._headers(),
        )
        return self._json(response)


def _now_ms() -> int:
    return int(time.time() * 1000)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="InstaLing — uniwersalny klient sesji nauki")
    parser.add_argument("--login", default=os.getenv("INSTALING_LOGIN"), help="login ucznia")
    parser.add_argument("--password", default=os.getenv("INSTALING_PASSWORD"), help="hasło ucznia")
    parser.add_argument("--child-id", type=int, default=None, help="pomiń wykrywanie z redirectu")
    parser.add_argument(
        "--dict-path",
        type=Path,
        default=Path(os.getenv("INSTALING_DICT", str(DEFAULT_DICT_PATH))),
        help="plik słownika word_id -> odpowiedź",
    )
    parser.add_argument("--solve", action="store_true", help="rozwiąż całą sesję")
    parser.add_argument("--delay", type=float, default=3.0, help="przerwa między słówkami (s)")
    parser.add_argument("--max-words", type=int, default=200, help="limit słówek w --solve")
    parser.add_argument("--info", action="store_true", help="pokaż child_id, URL sesji i version")
    parser.add_argument("--next", action="store_true", help="pobierz bieżące słówko")
    parser.add_argument("--words", type=int, default=0, metavar="N", help="pobierz N odpowiedzi endpointu")
    parser.add_argument("--answer", nargs=2, metavar=("WORD_ID", "ANSWER"), help="zapisz odpowiedź")
    parser.add_argument("--comment", nargs=2, metavar=("WORD_ID", "COMMENT"), help="zgłoś błąd")
    parser.add_argument("--audio", metavar="WORD_ID", help="pobierz URL nagrania")
    parser.add_argument("--grade", action="store_true", help="pobierz raport oceny sesji")
    parser.add_argument("--json", action="store_true", help="wypisz surowy JSON")
    return parser


def _resolve_credentials(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    if not args.login and sys.stdin.isatty():
        args.login = input("Login InstaLing: ").strip()
    if not args.password and sys.stdin.isatty():
        args.password = getpass.getpass("Hasło InstaLing: ")
    if not args.login or not args.password:
        parser.error(
            "Podaj --login i --password albo ustaw INSTALING_LOGIN / INSTALING_PASSWORD."
        )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _resolve_credentials(args, parser)

    try:
        with InstaLingClient(
            args.login,
            args.password,
            args.child_id,
            dict_path=args.dict_path,
        ) as client:
            result: dict[str, Any] = {
                "child_id": client.child_id,
                "session_url": client.session_url,
                "version": client.version,
            }
            wants_action = any(
                (args.solve, args.next, args.words, args.answer, args.comment, args.audio, args.grade)
            )
            if args.info or not wants_action:
                result["init"] = client.init_session()
                result["language_id"] = client.language_id
                result["language_code"] = client.language_code

            if args.solve:
                result["solve"] = client.solve_session(
                    delay=args.delay,
                    max_words=args.max_words,
                    verbose=not args.json,
                )

            if args.next:
                result["word"] = client.next_word()

            if args.words:
                result["words"] = [client.next_word() for _ in range(args.words)]

            if args.answer:
                word_id, answer = args.answer
                result["answer"] = client.save_answer(word_id, answer)
                correct = result["answer"].get("word") or result["answer"].get("answershow")
                if correct:
                    client.remember(word_id, correct)

            if args.comment:
                word_id, comment = args.comment
                result["comment"] = client.save_comment(word_id, comment)

            if args.audio:
                result["audio_url"] = client.audio_url(args.audio)

            if args.grade:
                result["grade"] = client.grade_report()

            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print(f"child_id: {result['child_id']}")
                print(f"session:  {result['session_url']}")
                print(f"version:  {result['version']}")
                if "language_code" in result:
                    print(f"język:    {result['language_code']} (id={result.get('language_id')})")
                if "word" in result:
                    word = result["word"]
                    if "id" in word:
                        print(f"\nsłówko id={word['id']}: {word.get('translations', '')}")
                        print(f"  przykład: {word.get('usage_example', '')}")
                    else:
                        print(f"\nkoniec sesji: {word.get('summary', '')}")
                if "words" in result:
                    print(f"\npobrano {len(result['words'])} odpowiedzi generate_next_word.php")
                if "answer" in result:
                    print(
                        f"\nodpowiedź: grade={result['answer'].get('grade')} "
                        f"word={result['answer'].get('word')!r}"
                    )
                if "grade" in result:
                    print(f"\nocena: {result['grade']}")
                if "audio_url" in result:
                    print(f"\naudio: {result['audio_url']}")
        return 0
    except InstaLingError as exc:
        print(f"Błąd: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
