$ErrorActionPreference = 'Stop'
$taskData = Join-Path $PSScriptRoot 'data'
$taskPidFile = Join-Path $taskData 'server.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'Aucun serveur démarré par cette copie.'; exit }
$taskPid = [int](Get-Content -LiteralPath $taskPidFile)
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid"
if ($taskProcess) {
    $taskScript = Join-Path $PSScriptRoot 'arty_index.py'
    if (-not $taskProcess.CommandLine.Contains($taskScript) -or -not $taskProcess.CommandLine.Contains($taskData)) { throw 'Le processus ne correspond plus à cette copie. Aucun arrêt effectué.' }
    Stop-Process -Id $taskPid
}
Remove-Item -LiteralPath $taskPidFile
Write-Host 'Serveur Arty Index arrêté. Vos pages restent enregistrées.'
