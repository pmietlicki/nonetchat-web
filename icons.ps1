# New-PwaIcons.ps1
param(
  [string]$Src = "logo.png",
  [string]$Out = "public\icons",
  [string]$Bg  = "#0EA5E9"
)

# --- Prérequis ---
$magick = Get-Command magick -ErrorAction SilentlyContinue
if (-not $magick) { throw "ImageMagick (magick.exe) introuvable dans le PATH." }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
if (-not (Test-Path $Src)) { throw "Fichier source introuvable: $Src" }

# --- Any (fond transparent), contenu ~90% ---
# 192
& $magick $Src -resize 172x172 -gravity center -background none -extent 192x192 `
  (Join-Path $Out "icon-192.png")
# 512
& $magick $Src -resize 460x460 -gravity center -background none -extent 512x512 `
  (Join-Path $Out "icon-512.png")

# --- Maskable (fond plein + marge ~10% par côté ≈ contenu ~80%) ---
# 192
& $magick $Src -resize 154x154 -gravity center -background $Bg -extent 192x192 `
  (Join-Path $Out "icon-192-maskable.png")
# 512
& $magick $Src -resize 410x410 -gravity center -background $Bg -extent 512x512 `
  (Join-Path $Out "icon-512-maskable.png")

# --- Monochrome 96 (badge) : blanc sur transparent ---
& $magick $Src -resize 72x72 -gravity center -background none -extent 96x96 `
  -fill white -colorize 100 `
  (Join-Path $Out "icon-96-monochrome.png")

# --- Apple Touch 180 (iOS) : fond plein, pas de transparence ---
& $magick $Src -resize 162x162 -gravity center -background white -extent 180x180 `
  (Join-Path $Out "apple-touch-icon-180.png")

Write-Host "Icônes générées dans $Out"
