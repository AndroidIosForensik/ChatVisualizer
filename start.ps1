# Lokaler Webserver fuer ChatVisualizer - ohne Installation, nur Windows-Bordmittel.
# Normalerweise per Doppelklick auf "ChatVisualizer starten.cmd" aufgerufen.
#
#   .\start.ps1                 sucht einen freien Port ab 8777 und oeffnet den Browser
#   .\start.ps1 -Port 9000      benutzt genau diesen Port
#   .\start.ps1 -NoBrowser      startet nur den Server
#   .\start.ps1 -KeinModell     ohne die Spracherkennung starten (nichts nachladen)
#
# Fehlt das Spracherkennungsmodell, wird es beim ersten Start automatisch
# geladen (rund 242 MB, siehe modelle\quellen.json).
#
# Beenden: Strg+C oder das Fenster schliessen.

param(
  [int]$Port = 0,
  [switch]$NoBrowser,
  [switch]$KeinModell
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $root) { $root = (Get-Location).Path }
$resolvedRoot = (Resolve-Path $root).Path

if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host "index.html wurde neben start.ps1 nicht gefunden ($root)." -ForegroundColor Red
  exit 3
}

# --- Spracherkennungsmodell nachladen ---------------------------------------
# Das Modell ist zu gross fuer den Git-Speicher und wird deshalb beim ersten
# Start geholt. Was dazugehoert, steht in modelle\quellen.json.

# Die Beschreibungen dort enthalten Umlaute - ohne das hier zeigt die Konsole
# Kraehenfuesse an.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Format-Menge([double]$bytes) {
  if ($bytes -lt 1MB) { return ('{0:N0} KB' -f ($bytes / 1KB)) }
  return ('{0:N1} MB' -f ($bytes / 1MB))
}

function Get-FehlendeDateien($modell, $modelleOrdner) {
  $offen = New-Object System.Collections.ArrayList
  foreach ($d in $modell.dateien) {
    $ziel = Join-Path $modelleOrdner (($modell.name -replace '/', '\') + '\' + ($d.pfad -replace '/', '\'))
    $fehlt = -not (Test-Path $ziel -PathType Leaf)
    if (-not $fehlt -and (Get-Item $ziel).Length -ne $d.bytes) { $fehlt = $true }
    if ($fehlt) { [void]$offen.Add([pscustomobject]@{ Datei = $d; Ziel = $ziel }) }
  }
  return $offen
}

function Get-Datei($url, $ziel, [long]$groesse, [int]$nummer, [int]$gesamt) {
  $ordner = Split-Path -Parent $ziel
  if (-not (Test-Path $ordner)) { New-Item -ItemType Directory -Force -Path $ordner | Out-Null }

  # Angefangene Downloads liegen als *.teil daneben und werden fortgesetzt
  $teil = "$ziel.teil"
  [long]$da = 0
  if (Test-Path $teil) { $da = (Get-Item $teil).Length }
  if ($da -gt $groesse) { Remove-Item $teil -Force; $da = 0 }

  $name = Split-Path -Leaf $ziel
  $zusatz = ''
  if ($da -gt 0) { $zusatz = '  fortgesetzt bei ' + (Format-Menge $da) }
  Write-Host ("  [{0}/{1}] {2}  ({3}){4}" -f $nummer, $gesamt, $name, (Format-Menge $groesse), $zusatz)

  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $anfrage = [System.Net.HttpWebRequest]::Create($url)
  $anfrage.UserAgent = 'ChatVisualizer'
  $anfrage.Timeout = 60000
  $anfrage.ReadWriteTimeout = 180000
  if ($da -gt 0) { $anfrage.AddRange([long]$da) }

  $antwort = $anfrage.GetResponse()
  # Ignoriert der Server die Fortsetzung, faengt die Datei von vorn an
  $fortsetzen = ($antwort.StatusCode -eq [System.Net.HttpStatusCode]::PartialContent -and $da -gt 0)
  if (-not $fortsetzen) { $da = 0 }
  $modus = [System.IO.FileMode]::Create
  if ($fortsetzen) { $modus = [System.IO.FileMode]::Append }

  $quelle = $antwort.GetResponseStream()
  $ausgabe = New-Object System.IO.FileStream($teil, $modus, [System.IO.FileAccess]::Write)
  try {
    $puffer = New-Object byte[] 262144
    [long]$geladen = $da
    $uhr = [System.Diagnostics.Stopwatch]::StartNew()
    $letzte = 0
    while ($true) {
      $gelesen = $quelle.Read($puffer, 0, $puffer.Length)
      if ($gelesen -le 0) { break }
      $ausgabe.Write($puffer, 0, $gelesen)
      $geladen += $gelesen
      if ($uhr.ElapsedMilliseconds - $letzte -gt 400) {
        $letzte = $uhr.ElapsedMilliseconds
        $anteil = 0
        if ($groesse -gt 0) { $anteil = $geladen * 100.0 / $groesse }
        Write-Host ("`r        {0,5:N1} %  {1} von {2}   " -f $anteil, (Format-Menge $geladen), (Format-Menge $groesse)) -NoNewline
      }
    }
  } finally {
    $ausgabe.Close(); $quelle.Close(); $antwort.Close()
  }
  Write-Host ("`r        fertig: {0}{1}" -f (Format-Menge $groesse), (' ' * 22))

  if ((Get-Item $teil).Length -ne $groesse) {
    throw ("unerwartete Groesse ({0} statt {1})" -f (Get-Item $teil).Length, $groesse)
  }
  if (Test-Path $ziel) { Remove-Item $ziel -Force }
  Move-Item $teil $ziel
}

function Write-Verzeichnis($modelle, $modelleOrdner) {
  $fertig = @()
  foreach ($m in $modelle) {
    if ((Get-FehlendeDateien $m $modelleOrdner).Count -eq 0) {
      $fertig += [pscustomobject]@{ name = $m.name; bytes = $m.bytes }
    }
  }
  if ($fertig.Count -eq 0) { return }
  $inhalt = [pscustomobject]@{
    hinweis = 'Erzeugt von start.ps1. Welche Modelle bereitliegen; "bytes" dient nur der Fortschrittsanzeige.'
    modelle = $fertig
  }
  $ziel = Join-Path $modelleOrdner 'verzeichnis.json'
  ($inhalt | ConvertTo-Json -Depth 4) | Out-File -FilePath $ziel -Encoding utf8
}

function Get-Modelle($root) {
  $modelleOrdner = Join-Path $root 'modelle'
  $quellen = Join-Path $modelleOrdner 'quellen.json'
  if (-not (Test-Path $quellen)) { return }

  $modelle = @((Get-Content $quellen -Raw -Encoding UTF8 | ConvertFrom-Json).modelle)
  Write-Verzeichnis $modelle $modelleOrdner

  $auftrag = @()
  foreach ($m in $modelle) {
    $offen = Get-FehlendeDateien $m $modelleOrdner
    if ($offen.Count -gt 0) { $auftrag += [pscustomobject]@{ Modell = $m; Offen = $offen } }
  }
  if ($auftrag.Count -eq 0) { return }

  $menge = 0
  foreach ($a in $auftrag) { foreach ($o in $a.Offen) { $menge += $o.Datei.bytes } }

  Write-Host ""
  Write-Host ("  Spracherkennung: {0} werden einmalig geladen." -f (Format-Menge $menge)) -ForegroundColor Cyan
  foreach ($a in $auftrag) { Write-Host ("  {0} - {1}" -f $a.Modell.name, $a.Modell.beschreibung) -ForegroundColor DarkGray }
  Write-Host "  Quelle: huggingface.co - Abbrechen mit Strg+C, der Rest laeuft auch ohne." -ForegroundColor DarkGray
  Write-Host ""

  foreach ($a in $auftrag) {
    $nummer = 0
    foreach ($o in $a.Offen) {
      $nummer++
      $url = $a.Modell.basis + $o.Datei.pfad
      $geschafft = $false
      for ($versuch = 1; $versuch -le 3; $versuch++) {
        try { Get-Datei $url $o.Ziel $o.Datei.bytes $nummer $a.Offen.Count; $geschafft = $true; break }
        catch {
          if ($versuch -eq 3) {
            Write-Host ""
            Write-Host ("  Fehlgeschlagen: {0} ({1})" -f $o.Datei.pfad, $_.Exception.Message) -ForegroundColor Yellow
            Write-Host "  ChatVisualizer startet trotzdem - nur die Transkription bleibt aus." -ForegroundColor DarkGray
            Write-Host "  Spaeter erneut versuchen: einfach neu starten." -ForegroundColor DarkGray
            Write-Host ""
            return
          }
          Write-Host ("        Neuer Versuch ({0}/3) ..." -f ($versuch + 1)) -ForegroundColor DarkGray
          Start-Sleep -Seconds 2
        }
      }
      if (-not $geschafft) { return }
    }
  }

  Write-Verzeichnis $modelle $modelleOrdner
  Write-Host "  Spracherkennung ist bereit." -ForegroundColor Green
  Write-Host ""
}

if (-not $KeinModell) {
  try { Get-Modelle $root }
  catch {
    Write-Host ("  Modell konnte nicht geladen werden: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    Write-Host "  ChatVisualizer startet ohne Spracherkennung." -ForegroundColor DarkGray
  }
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.onnx' = 'application/octet-stream'
  '.json' = 'application/json; charset=utf-8'
  '.csv'  = 'text/csv; charset=utf-8'
  '.tsv'  = 'text/tab-separated-values; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.avif' = 'image/avif'
  '.heic' = 'image/heic'
  '.heif' = 'image/heif'
  '.bmp'  = 'image/bmp'
  '.ico'  = 'image/x-icon'
  '.mp4'  = 'video/mp4'
  '.m4v'  = 'video/mp4'
  '.3gp'  = 'video/3gpp'
  '.webm' = 'video/webm'
  '.mov'  = 'video/quicktime'
  '.mp3'  = 'audio/mpeg'
  '.ogg'  = 'audio/ogg'
  '.opus' = 'audio/ogg'
  '.oga'  = 'audio/ogg'
  '.wav'  = 'audio/wav'
  '.m4a'  = 'audio/mp4'
  '.aac'  = 'audio/aac'
  '.flac' = 'audio/flac'
  '.amr'  = 'audio/amr'
  '.pdf'  = 'application/pdf'
}

# --- freien Port suchen ------------------------------------------------------
if ($Port -gt 0) { $candidates = @($Port) } else { $candidates = 8777..8797 }

$listener = $null
$chosen = 0
foreach ($p in $candidates) {
  $try = New-Object System.Net.HttpListener
  $try.Prefixes.Add("http://localhost:$p/")
  try {
    $try.Start()
    $listener = $try
    $chosen = $p
    break
  } catch {
    try { $try.Close() } catch { }
  }
}

if (-not $listener) {
  Write-Host ""
  if ($Port -gt 0) {
    Write-Host "  Port $Port ist belegt. Anderen Port waehlen, z. B.:  .\start.ps1 -Port 9000" -ForegroundColor Red
  } else {
    Write-Host "  Kein freier Port zwischen 8777 und 8797 gefunden." -ForegroundColor Red
    Write-Host "  Eigenen Port waehlen:  .\start.ps1 -Port 9000" -ForegroundColor DarkGray
  }
  Write-Host ""
  exit 3
}

$url = "http://localhost:$chosen/"
$host.UI.RawUI.WindowTitle = "ChatVisualizer - $url (Fenster schliessen zum Beenden)"

Write-Host ""
Write-Host "  ChatVisualizer laeuft" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor White
Write-Host ""
Write-Host "  Ordner:  $resolvedRoot" -ForegroundColor DarkGray
Write-Host "  Beenden: Strg+C oder dieses Fenster schliessen" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  # Zuerst Chrome, dann Edge: nur sie uebersetzen lokal (Translator-API). Sonst der Standardbrowser.
  function Find-Browser($exe, $unterpfad) {
    foreach ($wurzel in 'HKCU:', 'HKLM:') {
      try {
        $p = (Get-ItemProperty -Path "$wurzel\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'
        if ($p -and (Test-Path -LiteralPath $p.Trim('"'))) { return $p.Trim('"') }
      } catch { }
    }
    foreach ($ordner in $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) {
      if ($ordner -and (Test-Path -LiteralPath (Join-Path $ordner $unterpfad))) { return (Join-Path $ordner $unterpfad) }
    }
    return $null
  }
  $browser = Find-Browser 'chrome.exe' 'Google\Chrome\Application\chrome.exe'
  if (-not $browser) { $browser = Find-Browser 'msedge.exe' 'Microsoft\Edge\Application\msedge.exe' }
  try {
    if ($browser) { Start-Process -FilePath $browser -ArgumentList $url }
    else {
      Start-Process $url
      Write-Host "  Chrome/Edge nicht gefunden - Standardbrowser geoeffnet. Zum Uebersetzen Chrome oder Edge nutzen." -ForegroundColor Yellow
    }
  } catch { Write-Host "  Browser bitte manuell oeffnen: $url" -ForegroundColor Yellow }
}

# --- Anfragen bedienen -------------------------------------------------------
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
      # RawUrl bewahrt maskierte # und ? im Dateinamen auch unter Windows PowerShell.
      $path = [System.Uri]::UnescapeDataString(($context.Request.RawUrl -split '\?', 2)[0])
      if ($path -eq '/') { $path = '/index.html' }

      $full = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
      $ok = $false
      $resolved = $null
      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $resolved = (Resolve-Path -LiteralPath $full).Path
        # Nur Dateien innerhalb des Projektordners ausliefern
        if ($resolved.StartsWith($resolvedRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $ok = $true }
      }

      if ($ok) {
        $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $response.ContentType = $type
        $response.Headers.Add('Accept-Ranges', 'bytes')
        if ($ext -eq '.onnx' -or $ext -eq '.wasm') {
          $response.Headers.Add('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          $response.Headers.Add('Cache-Control', 'no-cache')
        }
        # Medienplayer laden Dateiausschnitte (auch vom Ende) für Start und Spulen.
        # In Blöcken senden, statt große Videos komplett in den Speicher zu lesen.
        $stream = [System.IO.File]::OpenRead($resolved)
        try {
          [long]$length = $stream.Length
          [long]$from = 0
          [long]$to = $length - 1
          $range = $context.Request.Headers['Range']
          $valid = $true
          if ($range -and $range -notmatch ',') {
            if ($range -match '^bytes=(\d*)-(\d*)$' -and $length -gt 0) {
              $startText = $Matches[1]; $endText = $Matches[2]
              if ($startText -eq '') {
                [long]$suffix = 0
                $valid = [long]::TryParse($endText, [ref]$suffix) -and $suffix -gt 0
                if ($valid) { $from = [Math]::Max(0, $length - $suffix) }
              } else {
                $valid = [long]::TryParse($startText, [ref]$from)
                if ($endText -ne '') { $valid = [long]::TryParse($endText, [ref]$to) -and $valid }
                $to = [Math]::Min($to, $length - 1)
                $valid = $valid -and $from -lt $length -and $to -ge $from
              }
            } else { $valid = $false }
            if ($valid) {
              $response.StatusCode = 206
              $response.Headers.Add('Content-Range', "bytes $from-$to/$length")
            }
          }
          if (-not $valid) {
            $response.StatusCode = 416
            $response.Headers.Add('Content-Range', "bytes */$length")
            $response.ContentLength64 = 0
          } else {
            [long]$remaining = $to - $from + 1
            $response.ContentLength64 = $remaining
            if ($context.Request.HttpMethod -ne 'HEAD') {
              [void]$stream.Seek($from, [System.IO.SeekOrigin]::Begin)
              $buffer = New-Object byte[] 65536
              while ($remaining -gt 0) {
                $read = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
                if ($read -le 0) { break }
                $response.OutputStream.Write($buffer, 0, $read)
                $remaining -= $read
              }
            }
          }
        } finally { $stream.Close() }
      } else {
        $response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 - nicht gefunden')
        $response.ContentType = 'text/plain; charset=utf-8'
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      # Abgebrochene Anfrage (z. B. Video-Spulen): still ignorieren
    } finally {
      try { $response.OutputStream.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop(); $listener.Close() } catch { }
  Write-Host "  ChatVisualizer beendet." -ForegroundColor DarkGray
}
