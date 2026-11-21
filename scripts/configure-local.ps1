# Run interactively. Secrets never appear in arguments or console output.
param([switch]$SetGarminKey)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $projectDir '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes)
  $rng.Dispose()
  [IO.File]::WriteAllText($envPath, "GARMIN_API_KEY=`nGARMIN_ALLOW_NETWORK=false`nMCP_AUTH_TOKEN=$token`nPORT=8091`n")
}
# Restrict the local plaintext environment file to this Windows user and SYSTEM.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($name in @($identity, 'NT AUTHORITY\SYSTEM')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($name, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $envPath -AclObject $acl
if ($SetGarminKey) {
  $secure = Read-Host 'Garmin Personal API key (hidden)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($key -notmatch '^[A-Za-z0-9._~+/=-]+$') { throw 'Unexpected key characters; no changes saved.' }
    $text = [IO.File]::ReadAllText($envPath)
    $text = [regex]::Replace($text, '(?m)^GARMIN_API_KEY=.*$', ('GARMIN_API_KEY=' + $key))
    [IO.File]::WriteAllText($envPath, $text)
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $key = $null }
}
Write-Output 'Local configuration saved with restricted permissions. Live API access remains unchanged.'
