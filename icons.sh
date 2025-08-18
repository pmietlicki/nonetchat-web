#!/usr/bin/env bash
set -euo pipefail

SRC="logo.png"
OUT="public/icons"
BG="#0EA5E9"

mkdir -p "$OUT"

# --- Any (fond transparent) ---
# 192 (contenu ~90%)
convert "$SRC" -resize 172x172 -gravity center -background none -extent 192x192 "$OUT/icon-192.png"
# 512 (contenu ~90%)
convert "$SRC" -resize 460x460 -gravity center -background none -extent 512x512 "$OUT/icon-512.png"

# --- Maskable (plein cadre, avec marge ~10% par côté ≈ contenu 80%) ---
# 192
convert "$SRC" -resize 154x154 -gravity center -background "$BG" -extent 192x192 "$OUT/icon-192-maskable.png"
# 512
convert "$SRC" -resize 410x410 -gravity center -background "$BG" -extent 512x512 "$OUT/icon-512-maskable.png"

# --- Monochrome 96 (badge) : blanc sur transparent ---
convert "$SRC" -resize 72x72 -gravity center -background none -extent 96x96 \
  -fill white -colorize 100 "$OUT/icon-96-monochrome.png"

# --- Apple Touch (iOS) 180 : fond plein, pas de transparence ---
convert "$SRC" -resize 162x162 -gravity center -background white -extent 180x180 \
  "$OUT/apple-touch-icon-180.png"

echo "Icônes générées dans $OUT"