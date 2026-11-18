@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem ── locate a Python interpreter (PATH first, then the py launcher) ──────
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (
    where py >nul 2>nul && set "PY=py -3"
)
if not defined PY (
    echo Python was not found on PATH. Install Python 3.10+ and try again.
    pause
    exit /b 1
)

echo ============================================================
echo  Clinical Trial Eligibility Matching Desk
echo  CA2 Q1 - Group 1
echo ============================================================
echo.
echo Choose what to run:
echo   1. Full evaluation (all 10 patients)
echo   2. Step-by-step demo (P008 - borderline case)
echo   3. Single patient verdict
echo   4. Interactive human-in-the-loop (P008)
echo   5. Website + Semantic Kernel server (http://localhost:8000)
echo.
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" (
    %PY% main.py
) else if "%choice%"=="2" (
    %PY% main.py demo P008
) else if "%choice%"=="3" (
    set /p caseid="Enter case ID (P001-P010): "
    %PY% main.py case !caseid!
) else if "%choice%"=="4" (
    %PY% main.py loop P008
) else if "%choice%"=="5" (
    start "" http://localhost:8000
    %PY% server.py
) else (
    echo Invalid choice.
)
pause
