<#
.SYNOPSIS
  Rebuilds public\crash\kgffc-crash-kit.zip from public\crash\kit\. Run it after changing anything in the kit.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File agent\build-crash-kit.ps1
#>
$ErrorActionPreference = "Stop"
$kit = Join-Path $PSScriptRoot "..\public\crash\kit" | Resolve-Path
$zip = Join-Path $PSScriptRoot "..\public\crash\kgffc-crash-kit.zip"

# Batch files and Notepad want Windows line endings; PowerShell 5.1 wants a BOM for non-ASCII scripts.
foreach ($f in Get-ChildItem $kit -File) {
  $text = [IO.File]::ReadAllText($f.FullName) -replace "`r?`n", "`r`n"
  $bom = $f.Extension -eq ".ps1"
  [IO.File]::WriteAllText($f.FullName, $text, (New-Object Text.UTF8Encoding($bom)))
}
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $kit "*") -DestinationPath $zip
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1KB, 1)) KB)"
