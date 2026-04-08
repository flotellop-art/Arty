@echo off
echo.
echo  Installation du demarrage automatique...
echo.

:: Create shortcut to start-all.bat in Windows Startup folder
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0start-all.bat"
set "SHORTCUT=%STARTUP%\FacadesPollet.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Facades Pollet - Services Locaux'; $s.Save()"

if exist "%SHORTCUT%" (
    echo  OK ! Raccourci cree dans le dossier Startup.
    echo  Les services demarreront automatiquement au prochain lancement de Windows.
    echo.
    echo  Emplacement : %SHORTCUT%
) else (
    echo  ERREUR : impossible de creer le raccourci.
)

echo.
pause
