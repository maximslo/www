#!/usr/bin/env bash
#
# Regenerates src/fonts/*-subset.woff2 from the full @fontsource files in
# node_modules. Those subsets get base64-inlined into every page's <head> by
# BaseLayout.astro, so their size is paid on the critical path — hence the
# aggressive cut (Geist Sans 33.4kB -> 12.5kB, Geist Mono 10.0kB -> 7.9kB).
#
# Only run this when the fonts change or the site needs a character the subset
# doesn't cover. Requires fonttools + brotli:
#
#   python3 -m venv .venv && .venv/bin/pip install fonttools brotli
#   PYFTSUBSET=.venv/bin/pyftsubset ./scripts/subset-fonts.sh
#
# Coverage: Basic Latin + Latin-1 (accented Western European names), general
# punctuation, currency, letterlike symbols, arrows (the ↗ in .arrow lives at
# U+2197), math operators, box drawing, geometric shapes, dingbats.
# Deliberately NOT included is Latin Extended-A (U+0100-017F —
# Polish/Czech/Turkish diacritics), which costs ~2.9kB for characters this site
# has never used. Add it to UNICODES below if a project write-up ever needs it,
# and re-run.
#
# Box drawing (U+2500-257F) is a THIRD subset, cut from @fontsource's
# `symbols2` file rather than added to the ranges above — the `latin` file
# Geist Mono's main subset comes from has no box-drawing glyphs at all, so
# widening UNICODES would silently do nothing. It exists for the wapo CLI case
# study (project-two.mdx), whose transcripts draw ┌─┬┐ tables: without it those
# characters fall back per-character to the next font in --font-mono, which
# breaks every table's column alignment.
#
# Deliberately NOT covered, and left to that same per-character fallback: the
# status glyphs (✔ ⨯ ● ▲ ➜ ✗), the cli-spinners braille frames, and arrows —
# Geist Mono ships none of them in any subset, and they're standalone
# characters whose neighbours don't have to line up with anything.
#
# --no-hinting is safe (woff2 hinting is ignored by every modern renderer) and
# --desubroutinize trades a slightly larger CFF table for better woff2/brotli
# compression, which is the size that actually matters here.
set -euo pipefail

cd "$(dirname "$0")/.."

PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"

UNICODES='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20A0-20BF,U+2100-2138,U+2190-21FF,U+2200-22FF,U+25A0-25FF'
BOX_UNICODES='U+2500-257F'

subset() {
	local src="$1" out="$2" unicodes="${3:-$UNICODES}"
	"$PYFTSUBSET" "$src" \
		--unicodes="$unicodes" \
		--layout-features='kern,liga,calt,ccmp,locl,rlig' \
		--flavor=woff2 \
		--no-hinting \
		--desubroutinize \
		--output-file="$out"
	printf '%s: %s -> %s bytes\n' "$out" "$(wc -c <"$src" | tr -d ' ')" "$(wc -c <"$out" | tr -d ' ')"
}

subset node_modules/@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2 src/fonts/geist-sans-400-subset.woff2
subset node_modules/@fontsource/geist-mono/files/geist-mono-latin-300-normal.woff2 src/fonts/geist-mono-300-subset.woff2
subset node_modules/@fontsource/geist-mono/files/geist-mono-symbols2-300-normal.woff2 src/fonts/geist-mono-300-box-subset.woff2 "$BOX_UNICODES"
