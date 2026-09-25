@echo off
title KGFFC Crash Kitchen - PLATING
rem Packs the newest recording plus Windows' crash clues into one text file on your Desktop.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kgffc-crash.ps1" -Mode Plate
pause
