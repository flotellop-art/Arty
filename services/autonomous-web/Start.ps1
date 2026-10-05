$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskData = Join-Path $taskRoot 'data'
$taskScript = Join-Path $taskRoot 'arty_index.py'
$taskPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    $taskPython = (Get-Command python -ErrorAction Stop).Source
}
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
# The persisted service credential belongs only to this Windows user/System.
. (Join-Path $taskRoot 'Protect-Data.ps1')
Protect-ArtyIndexData -Path $taskData
$taskConnection = Get-NetTCPConnection -State Listen -LocalPort 8789 -ErrorAction SilentlyContinue
if ($taskConnection) {
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskConnection[0].OwningProcess)"
    if (-not $taskProcess -or -not $taskProcess.CommandLine -or -not $taskProcess.CommandLine.Contains($taskScript) -or -not $taskProcess.CommandLine.Contains($taskData)) {
        throw 'Le port 8789 est déjà utilisé par un autre serveur. Fermez cet autre serveur avant de lancer cette copie.'
    }
} else {
    $taskArguments = @(('"' + $taskScript + '"'), '--data', ('"' + $taskData + '"'), 'serve')
    $taskStarted = Start-Process -FilePath $taskPython -ArgumentList $taskArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log')
    $taskStarted.Id | Set-Content -LiteralPath (Join-Path $taskData 'server.pid')
}
Write-Host 'Arty Index : http://127.0.0.1:8789'
Write-Host 'Ouvrez cette adresse dans votre navigateur. Aucun démarrage automatique Windows.'
