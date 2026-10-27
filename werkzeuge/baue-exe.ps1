# ChatVisualizer.exe bauen – eine einzige Datei, die das ganze Programm enthält.
#
#   .\werkzeuge\baue-exe.ps1               EXE ohne Modell (lädt es beim ersten Start nach)
#   .\werkzeuge\baue-exe.ps1 -MitModell    EXE mit Spracherkennungsmodell (rund 270 MB, ganz offline)
#
# Ergebnis: dist\ChatVisualizer.exe. Übersetzt wird mit csc.exe aus dem .NET Framework,
# das in Windows enthalten ist – es muss nichts installiert oder heruntergeladen werden.
# Eingepackt werden index.html, css, js, vendor, beispiel-daten … so, wie sie im Arbeitsordner
# liegen – ohne was .gitignore ausschließt (Modell, ZIPs, dist).

param([switch]$MitModell)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe aus dem .NET Framework 4 nicht gefunden.' }
$fw = Split-Path -Parent $csc

$arbeit = Join-Path $env:TEMP ('chatvisualizer-exe-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$app = Join-Path $arbeit 'app'
New-Item -ItemType Directory -Force -Path $app | Out-Null

try {
  # 1. Programmdateien aus Git (nur, was versioniert ist)
  $teile = @('index.html', 'css', 'js', 'vendor', 'beispiel-daten', 'modelle/quellen.json', 'LICENSE')
  # --others --exclude-standard: auch neue, noch nicht eingecheckte Dateien (aber nichts Ignoriertes)
  $dateien = & git -c core.quotepath=off ls-files --cached --others --exclude-standard -- $teile
  if ($LASTEXITCODE -ne 0 -or -not $dateien) { throw 'git ls-files fehlgeschlagen – im Repository ausführen.' }
  foreach ($d in $dateien) {
    $ziel = Join-Path $app ($d -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ziel) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root ($d -replace '/', '\')) -Destination $ziel
  }
  $appZip = Join-Path $arbeit 'app.zip'
  [System.IO.Compression.ZipFile]::CreateFromDirectory($app, $appZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  Write-Host ("  Programm: {0} Dateien, {1:N1} MB gepackt" -f $dateien.Count, ((Get-Item $appZip).Length / 1MB))

  $ressourcen = @("/resource:$appZip,app.zip")

  # 2. Optional das Spracherkennungsmodell (muss vorher über start.ps1 geladen worden sein)
  if ($MitModell) {
    $modell = Join-Path $arbeit 'modell'
    $quelle = Join-Path $root 'modelle\Xenova'
    if (-not (Test-Path (Join-Path $root 'modelle\verzeichnis.json')) -or -not (Test-Path $quelle)) {
      throw 'Kein vollständiges Modell in modelle\ – einmal "ChatVisualizer starten.cmd" ausführen, dann erneut bauen.'
    }
    New-Item -ItemType Directory -Force -Path $modell | Out-Null
    Copy-Item -Recurse -Path $quelle -Destination (Join-Path $modell 'Xenova')
    Get-ChildItem -Recurse -Path $modell -Filter '*.teil' | Remove-Item -Force
    $modellZip = Join-Path $arbeit 'modell.zip'
    # Modelldateien lassen sich kaum packen – ohne Kompression geht es schneller
    [System.IO.Compression.ZipFile]::CreateFromDirectory($modell, $modellZip, [System.IO.Compression.CompressionLevel]::NoCompression, $false)
    Write-Host ("  Modell:   {0:N1} MB" -f ((Get-Item $modellZip).Length / 1MB))
    $ressourcen += "/resource:$modellZip,modell.zip"
  }

  # 3. Übersetzen
  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $exe = Join-Path $dist 'ChatVisualizer.exe'
  # /codepage:65001 – Quelltext ist UTF-8 (Umlaute in den Meldungen der EXE)
  $argumente = @('/nologo', '/codepage:65001', '/target:exe', '/platform:anycpu', '/optimize+', "/out:$exe",
    "/r:$fw\System.IO.Compression.dll", "/r:$fw\System.IO.Compression.FileSystem.dll", "/r:$fw\System.Web.Extensions.dll") +
    $ressourcen + @((Join-Path $root 'werkzeuge\exe\ChatVisualizer.cs'))
  & $csc @argumente
  if ($LASTEXITCODE -ne 0) { throw 'Übersetzen fehlgeschlagen.' }
  Write-Host ("  Fertig:   {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB)) -ForegroundColor Green
}
finally {
  Remove-Item -Recurse -Force $arbeit -ErrorAction SilentlyContinue
}
