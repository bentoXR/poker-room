param(
  [int]$Version = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$swPath = Join-Path $root 'sw.js'
$htmlPath = Join-Path $root 'index.html'

$sw = Get-Content -Raw -Encoding UTF8 $swPath
if ($sw -notmatch "poker-room-v(\d+)") {
  throw "Não foi possível encontrar poker-room-vNNN em sw.js"
}

$atual = [int]$Matches[1]
$novo = if ($Version -gt 0) { $Version } else { $atual + 1 }

$swNovo = $sw -replace "poker-room-v$atual", "poker-room-v$novo"
Set-Content -Path $swPath -Value $swNovo -NoNewline -Encoding UTF8

$html = Get-Content -Raw -Encoding UTF8 $htmlPath
$htmlNovo = $html -replace "(\./(?:sw|js/main)\.js\?v=)\d+", "`${1}$novo"
Set-Content -Path $htmlPath -Value $htmlNovo -NoNewline -Encoding UTF8

Write-Output "Cache atualizado: v$atual -> v$novo"
