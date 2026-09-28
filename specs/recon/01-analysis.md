# 01 — Analysis: specs/recon/01-ad-playing.html

## 1. Classes on the #movie_player root element

Line 4: `id="movie_player"`

Line 2 (class attribute, full value):
`class="html5-video-player ytp-transparent ytp-exp-bottom-control-flexbox ytp-modern-caption ytp-exp-ppp-update ytp-livebadge-color ytp-grid-scrollable ytp-delhi-modern ytp-delhi-modern-icons ytp-delhi-horizontal-volume-controls ytp-cards-teaser-dismissible ytp-hide-info-bar ytp-disable-bottom-gradient ytp-delhi-modern-compact-controls ytp-large-width-mode ytp-fine-scrubbing-exp ad-created ad-showing ad-interrupting ytp-fit-cover-video playing-mode ytp-hide-fullscreen-title ytp-fullscreen-metadata-top ytp-autohide"`

**Is "ad-showing" present?** YES — line 2, token `ad-showing` (between `ad-created` and `ad-interrupting`).

## 2. The ⓘ / "Sponsored" ad-info button

- Tag: `button`
- Line: 1102–1107
- id: `button:4`
- class: `ytp-ad-button ytp-ad-button-link ytp-ad-clickable ytp-ad-hover-text-button--clean-player`
- aria-label: `My Ad Center` (line 1105: `aria-label="My Ad Center"`)
- role: NOT FOUND (no `role` attribute on this element)

Parent chain up to `#movie_player`:
1. `<span class="ytp-ad-hover-text-button ytp-ad-info-hover-text-button" id="ad-info-hover-text-button:3">` — line 1098–1101
2. `<div class="ytp-ad-player-overlay-layout__ad-info-container">` — line 1085
3. `<div class="ytp-ad-player-overlay-layout" id="player-overlay-layout:0" style="">` — line 1080–1083
4. `<div class="video-ads ytp-ad-module" data-layer="4">` — line 1078
5. `#movie_player` — line 1–4

(Note: the "Sponsored" badge is a separate sibling element — `<span class="ytp-ad-badge--clean-player ytp-ad-badge--stark-clean-player" id="ad-badge:1" style="">` at line 1086–1089, containing `<div class="ad-simple-attributed-string ytp-ad-badge__text--clean-player" id="ad-simple-attributed-string:2" aria-label="Sponsored" style="">Sponsored</div>` at line 1090–1096.)

## 3. Skip-ad button

NOT FOUND. Only an empty container exists:
Line 1136–1138: `<div class="ytp-ad-player-overlay-layout__skip-or-preview-container"></div>` — no button, no text inside it. No element with "skip" in its class, id, or text was found anywhere else in the file.

## 4. Any `<iframe>` element

NOT FOUND. No `<iframe` text appears anywhere in the file.

## 5. First line of the file, and total line count

First line (line 1): `<div`

Total line count: 1742
