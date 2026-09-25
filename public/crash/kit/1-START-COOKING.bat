@echo off
title KGFFC Crash Kitchen - COOKING (press Q to stop)
rem Records how hard and hot the PC works, once a second, until you press Q or the PC switches off.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kgffc-crash.ps1" -Mode Cook
pause
