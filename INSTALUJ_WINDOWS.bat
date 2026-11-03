@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title InstaLing Bot - instalator Windows

set "ROOT=%~dp0"
set "SRC=%ROOT%wtyczka"
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
set "TARGET=%LOCALAPPDATA%\InstaLingBot\extension"

echo ============================================================
echo   InstaLing Bot - uniwersalny instalator (Windows)
echo ============================================================
echo.
echo Wtyczka zostanie skopiowana do:
echo   %TARGET%
echo.
echo Mozesz od razu podac login i haslo (opcjonalnie).
echo Jesli pominiesz, wpiszesz je pozniej w kreatorze w przegladarce.
echo.

set "IL_LOGIN="
set /p "IL_LOGIN=Podaj swoj login InstaLing (lub Enter, aby wpisac pozniej w przegladarce): "
set "IL_PASS="
if not "!IL_LOGIN!"=="" (
  set /p "IL_PASS=Podaj haslo (widoczne w konsoli) lub Enter, aby pominac: "
)

echo.
echo Kopiowanie wtyczki...
if not exist "%TARGET%" mkdir "%TARGET%" >nul 2>&1
xcopy "%SRC%\*" "%TARGET%" /E /I /Y >nul
if errorlevel 1 (
  echo.
  echo BLAD: nie udalo sie skopiowac wtyczki do:
  echo   %TARGET%
  echo Sprawdz uprawnienia i sprobuj ponownie.
  pause
  exit /b 1
)

if not "!IL_LOGIN!"=="" if not "!IL_PASS!"=="" (
  echo Zapisywanie danych logowania w config.js ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$o=@{login=$env:IL_LOGIN;password=$env:IL_PASS;auto=$true}; $j=$o|ConvertTo-Json -Compress; Set-Content -Encoding UTF8 -Path '%TARGET%\config.js' -Value ('window.__IL_CONFIG__ = ' + $j + ';')" >nul 2>&1
  if errorlevel 1 (
    echo Nie udalo sie zapisac config.js - wpisz dane w kreatorze HUD.
  ) else (
    echo Zapisano konto do config.js.
  )
)

echo.
echo Kopiuje sciezke do schowka...
(echo %TARGET%)| clip >nul 2>&1

echo Otwieram instrukcje i strone rozszerzen...
start "" "%ROOT%START_INSTRUKCJA.html" >nul 2>&1

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" "chrome://extensions/"
) else (
  start "" "msedge" "edge://extensions/" >nul 2>&1
)

echo.
echo ============================================================
echo  GOTOWE. Zostaly 3 klikniecia w przegladarce:
echo    1. Wlacz "Tryb dewelopera" / "Developer mode".
echo    2. Kliknij "Zaladuj rozpakowane" / "Load unpacked".
echo    3. Wybierz folder:
echo       %TARGET%
echo.
echo  Sciezka jest juz w schowku - w oknie wyboru folderu
echo  wcisnij Ctrl+V i zatwierdz.
echo.
echo  Potem odswiez instaling.pl. Pojawi sie kreator konta
echo  (albo od razu HUD, jesli dane byly w config.js).
echo ============================================================
echo.
pause
endlocal
