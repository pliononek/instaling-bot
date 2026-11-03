#!/usr/bin/env bash
# InstaLing Bot - uniwersalny instalator (Linux / Chrome, Chromium, Edge, Brave)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ROOT/wtyczka"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
TARGET="$DATA_HOME/InstaLingBot/extension"

echo "============================================================"
echo "  InstaLing Bot - uniwersalny instalator (Linux)"
echo "============================================================"
echo
echo "Wtyczka zostanie skopiowana do:"
echo "  $TARGET"
echo
echo "Mozesz od razu podac login i haslo (opcjonalnie)."
echo "Jesli pominiesz, wpiszesz je pozniej w kreatorze w przegladarce."
echo

LOGIN=""
PASS=""
read -r -p "Podaj swoj login InstaLing (lub Enter, aby wpisac pozniej): " LOGIN || true
if [ -n "$LOGIN" ]; then
  read -r -s -p "Podaj haslo (nie bedzie widoczne) lub Enter, aby pominac: " PASS || true
  echo
fi

echo
echo "Kopiowanie wtyczki..."
mkdir -p "$TARGET"
cp -R "$SRC/." "$TARGET/"

if [ -n "$LOGIN" ] && [ -n "$PASS" ]; then
  if command -v python3 >/dev/null 2>&1; then
    echo "Zapisywanie danych logowania w config.js ..."
    IL_LOGIN="$LOGIN" IL_PASS="$PASS" IL_TARGET="$TARGET" python3 - <<'PY'
import json
import os

config = {
    "login": os.environ["IL_LOGIN"],
    "password": os.environ["IL_PASS"],
    "auto": True,
}
path = os.path.join(os.environ["IL_TARGET"], "config.js")
with open(path, "w", encoding="utf-8") as handle:
    handle.write("window.__IL_CONFIG__ = " + json.dumps(config, ensure_ascii=False) + ";\n")
print("Zapisano konto do config.js.")
PY
  else
    echo "python3 niedostepny - wpisz dane w kreatorze HUD po instalacji."
  fi
fi

# Schowek (opcjonalnie)
if command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$TARGET" | wl-copy >/dev/null 2>&1 || true
  echo "Sciezka skopiowana do schowka (wl-copy)."
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$TARGET" | xclip -selection clipboard >/dev/null 2>&1 || true
  echo "Sciezka skopiowana do schowka (xclip)."
elif command -v xsel >/dev/null 2>&1; then
  printf '%s' "$TARGET" | xsel --clipboard --input >/dev/null 2>&1 || true
  echo "Sciezka skopiowana do schowka (xsel)."
else
  echo "Brak narzedzia do schowka - sciezke masz wypisana wyzej."
fi

echo
echo "Otwieram instrukcje..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$ROOT/START_INSTRUKCJA.html" >/dev/null 2>&1 &
fi

cat <<EOF

============================================================
 GOTOWE. Zostaly 3 kroki w przegladarce:
   1. Otworz chrome://extensions (lub edge://extensions).
   2. Wlacz "Tryb dewelopera" / "Developer mode".
   3. Kliknij "Zaladuj rozpakowane" / "Load unpacked"
      i wybierz folder:

      $TARGET

 Potem odswiez instaling.pl. Pojawi sie kreator konta
 (albo od razu HUD, jesli dane byly w config.js).
============================================================

EOF

read -r -p "Nacisnij Enter, aby zakonczyc..." _ || true
