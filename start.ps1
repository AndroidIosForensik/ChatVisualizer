# Lokaler Webserver fuer ChatVisualizer - ohne Installation, nur Windows-Bordmittel.
# Normalerweise per Doppelklick auf "ChatVisualizer starten.cmd" aufgerufen.
#
#   .\start.ps1                 sucht einen freien Port ab 8777 und oeffnet den Browser
#   .\start.ps1 -Port 9000      benutzt genau diesen Port
#   .\start.ps1 -NoBrowser      startet nur den Server
#
# Beenden: Strg+C oder das Fenster schliessen.

param(
  [int]$Port = 0,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $root) { $root = (Get-Location).Path }
$resolvedRoot = (Resolve-Path $root).Path

if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host "index.html wurde neben start.ps1 nicht gefunden ($root)." -ForegroundColor Red
  exit 3
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
  '.bmp'  = 'image/bmp'
  '.ico'  = 'image/x-icon'
  '.mp4'  = 'video/mp4'
  '.webm' = 'video/webm'
  '.mov'  = 'video/quicktime'
  '.mp3'  = 'audio/mpeg'
  '.ogg'  = 'audio/ogg'
  '.opus' = 'audio/ogg'
  '.wav'  = 'audio/wav'
  '.m4a'  = 'audio/mp4'
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
  try { Start-Process $url } catch { Write-Host "  Browser bitte manuell oeffnen: $url" -ForegroundColor Yellow }
}

# --- Anfragen bedienen -------------------------------------------------------
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
      $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
      if ($path -eq '/') { $path = '/index.html' }

      $full = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
      $ok = $false
      $resolved = $null
      if (Test-Path $full -PathType Leaf) {
        $resolved = (Resolve-Path $full).Path
        # Nur Dateien innerhalb des Projektordners ausliefern
        if ($resolved.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $ok = $true }
      }

      if ($ok) {
        $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($resolved)
        $response.ContentType = $type
        if ($ext -eq '.onnx' -or $ext -eq '.wasm') {
          $response.Headers.Add('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          $response.Headers.Add('Cache-Control', 'no-cache')
        }
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
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
