function Protect-ArtyIndexData {
    param([Parameter(Mandatory = $true)][string] $Path)
    $taskOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $taskSystemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $taskRoot = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $taskRoot.PSIsContainer) { throw 'Le chemin des données doit être un dossier.' }
    $taskPrefix = $taskRoot.FullName.TrimEnd('\') + '\'
    $taskPending = [System.Collections.Generic.Stack[System.IO.FileSystemInfo]]::new()
    $taskPending.Push($taskRoot)
    while ($taskPending.Count) {
        $taskItem = $taskPending.Pop()
        if ($taskItem.FullName -ne $taskRoot.FullName -and
            -not $taskItem.FullName.StartsWith($taskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Chemin extérieur au dossier de données.'
        }
        if ($taskItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw 'Le dossier de données ne doit pas contenir de lien ou de jonction.'
        }
        if ($taskItem.PSIsContainer) {
            $taskAcl = [System.Security.AccessControl.DirectorySecurity]::new()
            $taskFlags = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
        } else {
            $taskAcl = [System.Security.AccessControl.FileSecurity]::new()
            $taskFlags = [System.Security.AccessControl.InheritanceFlags]::None
        }
        # Keep the existing owner. An owner can repair an empty DACL without
        # WRITE_OWNER, which is precisely the broken-launcher recovery case.
        $taskAcl.SetAccessRuleProtection($true, $false)
        foreach ($taskSid in @($taskOwnerSid, $taskSystemSid)) {
            $taskRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $taskSid, [System.Security.AccessControl.FileSystemRights]::FullControl,
                $taskFlags, [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow)
            $taskAcl.AddAccessRule($taskRule)
        }
        # Persist only the modified ACL sections; Set-Acl also tries to write
        # audit sections here and unnecessarily requests administrator privileges.
        if ('System.IO.FileSystemAclExtensions' -as [type]) {
            [System.IO.FileSystemAclExtensions]::SetAccessControl($taskItem, $taskAcl)
        } else {
            $taskItem.SetAccessControl($taskAcl) # Windows PowerShell 5.1 / .NET Framework.
        }
        if ($taskItem.PSIsContainer) {
            foreach ($taskChild in Get-ChildItem -LiteralPath $taskItem.FullName -Force -ErrorAction Stop) {
                $taskPending.Push($taskChild)
            }
        }
    }
}
