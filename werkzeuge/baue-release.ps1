# Release-Dateien bauen (aus dem eingecheckten Stand).
#
#   .\werkzeuge\baue-release.ps1 -Version v1.1.0              Ordner-ZIP + EXE
#   .\werkzeuge\baue-release.ps1 -Version v1.1.0 -MitModell   zusätzlich beide Offline-Varianten
#
# Ergebnis in dist\:
#   ChatVisualizer-<Version>.zip                    Ordner zum Entpacken (start.ps1 / start.sh)
#   ChatVisualizer-<Version>.exe                    eine Datei, Modell wird beim ersten Start geladen
#   ChatVisualizer-<Version>-offline-mit-Modell.zip  Ordner mit Spracherkennungsmodell (nur -MitModell)
#   ChatVisualizer-<Version>-offline-mit-Modell.exe  EXE mit Modell (nur -MitModell)
# -MitModell setzt ein vollständiges Modell in modelle\ voraus (einmal „ChatVisualizer starten.cmd“).

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$MitModell
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (& git status --porcelain --untracked-files=no) { throw 'Es gibt nicht eingecheckte Änderungen – erst committen, dann bauen.' }
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 1. Ordner-ZIP aus dem eingecheckten Stand (behält das Ausführrecht von start.sh)
$teile = @('index.html', 'css', 'js', 'vendor', 'beispiel-daten', 'modelle/quellen.json',
  'ChatVisualizer starten.cmd', 'start.ps1', 'start.sh', 'serve.py', 'hole-modell.py',
  'README.md', 'README.de.md', 'ARCHITEKTUR.md', 'LICENSE')
$zip = Join-Path $dist "ChatVisualizer-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
& git archive --format=zip --prefix=ChatVisualizer/ -o $zip HEAD -- $teile
if ($LASTEXITCODE -ne 0) { throw 'git archive fehlgeschlagen.' }
Write-Host ("  {0} ({1:N1} MB)" -f (Split-Path -Leaf $zip), ((Get-Item $zip).Length / 1MB))

# 2. EXE
& (Join-Path $PSScriptRoot 'baue-exe.ps1')
Copy-Item (Join-Path $dist 'ChatVisualizer.exe') (Join-Path $dist "ChatVisualizer-$Version.exe") -Force
Write-Host "  ChatVisualizer-$Version.exe"

# 3. Offline-Varianten mit Modell
if ($MitModell) {
  $offlineZip = Join-Path $dist "ChatVisualizer-$Version-offline-mit-Modell.zip"
  Copy-Item $zip $offlineZip -Force
  $archiv = [System.IO.Compression.ZipFile]::Open($offlineZip, 'Update')
  try {
    $modelle = Join-Path $root 'modelle'
    foreach ($datei in Get-ChildItem -Recurse -File -Path $modelle) {
      if ($datei.Name -eq 'quellen.json' -or $datei.Name -like '*.teil') { continue }
      $rel = $datei.FullName.Substring($root.Length + 1) -replace '\\', '/'
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archiv, $datei.FullName,
        "ChatVisualizer/$rel", [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archiv.Dispose() }
  Write-Host ("  {0} ({1:N1} MB)" -f (Split-Path -Leaf $offlineZip), ((Get-Item $offlineZip).Length / 1MB))

  & (Join-Path $PSScriptRoot 'baue-exe.ps1') -MitModell
  Copy-Item (Join-Path $dist 'ChatVisualizer.exe') (Join-Path $dist "ChatVisualizer-$Version-offline-mit-Modell.exe") -Force
  Write-Host "  ChatVisualizer-$Version-offline-mit-Modell.exe"
  & (Join-Path $PSScriptRoot 'baue-exe.ps1')          # dist\ChatVisualizer.exe wieder ohne Modell
}
