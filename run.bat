@echo off
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
echo.
set /p choice="Enter choice (1-4): "

if "%choice%"=="1" (
    C:\msys64\ucrt64\bin\python3.12.exe main.py
) else if "%choice%"=="2" (
    C:\msys64\ucrt64\bin\python3.12.exe main.py demo P008
) else if "%choice%"=="3" (
    set /p caseid="Enter case ID (P001-P010): "
    C:\msys64\ucrt64\bin\python3.12.exe main.py case %caseid%
) else if "%choice%"=="4" (
    C:\msys64\ucrt64\bin\python3.12.exe main.py loop P008
) else (
    echo Invalid choice.
)
pause
