$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Protect-Data.ps1')
$taskTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('arty-index-acl-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $taskTestRoot | Out-Null
try {
    $taskNested = Join-Path $taskTestRoot 'nested'
    New-Item -ItemType Directory -Path $taskNested | Out-Null
    $taskDb = Join-Path $taskTestRoot 'index.sqlite'
    $taskKey = Join-Path $taskNested 'service.key'
    Set-Content -LiteralPath $taskDb -Value 'synthetic existing database'
    Set-Content -LiteralPath $taskKey -Value 'synthetic test credential'
    # Reproduce an existing database denied to its owner by the old launcher.
    $taskBrokenAcl = [System.Security.AccessControl.FileSecurity]::new()
    $taskBrokenAcl.SetAccessRuleProtection($true, $false)
    $taskBrokenAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'Allow'))
    if ('System.IO.FileSystemAclExtensions' -as [type]) {
        [System.IO.FileSystemAclExtensions]::SetAccessControl((Get-Item -LiteralPath $taskDb), $taskBrokenAcl)
    } else {
        (Get-Item -LiteralPath $taskDb).SetAccessControl($taskBrokenAcl)
    }
    $taskSids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
    foreach ($taskPass in 1..2) {
        Protect-ArtyIndexData -Path $taskTestRoot
        foreach ($taskFile in @($taskDb, $taskKey)) {
            if (-not (Get-Content -LiteralPath $taskFile)) { throw 'Existing file unreadable.' }
            Add-Content -LiteralPath $taskFile -Value 'writable'
        }
        foreach ($taskItem in @((Get-Item -LiteralPath $taskTestRoot)) + @(Get-ChildItem -LiteralPath $taskTestRoot -Recurse -Force)) {
            $taskAcl = Get-Acl -LiteralPath $taskItem.FullName
            $taskRules = @($taskAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
            if ($taskRules.Count -ne 2 -or -not $taskAcl.AreAccessRulesProtected) { throw 'Unexpected access rules.' }
            foreach ($taskRule in $taskRules) {
                if ($taskRule.IdentityReference.Value -notin $taskSids -or
                    $taskRule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
                    $taskRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
                    throw 'Unexpected access grant.'
                }
            }
        }
    }
    $taskFuture = Join-Path $taskNested 'future.sqlite'
    Set-Content -LiteralPath $taskFuture -Value 'future database journal'
    $taskInherited = @((Get-Acl -LiteralPath $taskFuture).GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($taskInherited.Count -ne 2 -or @($taskInherited | Where-Object { -not $_.IsInherited -or $_.IdentityReference.Value -notin $taskSids }).Count) {
        throw 'New files do not inherit private access.'
    }
    Write-Host 'PASS: existing files stay readable and writable, new files inherit user/System access, repeated start is safe.'
} finally {
    $taskResolved = [System.IO.Path]::GetFullPath($taskTestRoot)
    $taskTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $taskResolved.StartsWith($taskTemp, [System.StringComparison]::OrdinalIgnoreCase) -or
        [System.IO.Path]::GetFileName($taskResolved) -notmatch '^arty-index-acl-[0-9a-f-]{36}$') {
        throw 'Unexpected temporary cleanup path.'
    }
    Remove-Item -LiteralPath $taskTestRoot -Recurse -Force
}
