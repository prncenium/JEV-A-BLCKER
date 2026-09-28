# 02 — Recon (verified against real YouTube DOM, desktop Chrome, English)

## Flow and DOM scopes

| Step | Action | Scope | Selector strategy |
|------|--------|-------|-------------------|
| 1 | Click ⓘ | Top page, inside #movie_player | button with aria-label "My Ad Center" inside .video-ads |
| 2 | Click Block | Iframe iframe[src*="aboutthisad"] (same-origin) | div[role=button][aria-label="Block"] |
| 3 | Click Continue | Same iframe | button whose text is "Continue", inside div[role=dialog][aria-label="Stop seeing this ad?"] |
| 4 | Click ✕ | Same iframe | the visible button[aria-label="Close"], not inside [role=banner] |

## Verified facts
- #movie_player has class ad-showing while an ad plays. R1 holds.
- The ⓘ button is a button, no role attribute, class ytp-ad-button, aria-label "My Ad Center". Its id is dynamic (button:N). Never match on id or class.
- The "Sponsored" badge is a separate sibling of the ⓘ button.
- No skip-ad button existed on the recorded ad. The skip container was empty.
- No iframe exists inside #movie_player. The panel iframe is rendered elsewhere on the page (yt-about-this-ad-renderer).
- The iframe is same-origin: contentDocument is readable. It contains no shadow DOM.
- The panel labels are dynamic: "See more <Advertiser> ads". Class names inside the iframe are obfuscated. Match on role and aria-label only.
- Three elements have aria-label "Close" inside the iframe. Only one is visible: a button, 48x48, outside [role=banner]. The other two are hidden (0x0).
- The "Stop seeing this ad?" dialog is inside the iframe. The top page has two hidden "Cancel" buttons that belong to autoplay. The executor must not search the top page for dialog buttons.
- The iframe header (role=banner) exposes the signed-in account name and email in an aria-label. The snapshot MUST exclude it.
- The iframe URL contains an account-linked token. Never log it, commit it, or send it to a model.

## Dangerous adjacent targets (never click)
Like ad, Report, See more <Advertiser> ads, See fewer <Advertiser> ads, Customize more of your ads (opens a new tab), Send feedback, Cancel, Main menu, Go back, Google apps, Google Account.

## Click allowlist
Exactly four targets: ⓘ (My Ad Center button in #movie_player), Block, Continue, Close (visible, outside banner).

## Still unknown
- Does the iframe exist before ⓘ is clicked, or is it created on click? How long until its content loads?
- Does the ad keep playing while the panel is open?
- Behavior when signed out.
- Skippable and other ad variants.

## Spec amendments required (not yet applied)
- 00-steering goal wording: Block and Continue, not "Block ad" and "confirm".
- R6: replace the single #movie_player scope with two scopes: #movie_player for step 1, the aboutthisad iframe for steps 2-4.
- R9: also exclude the iframe header, any element outside region[aria-label="Main ad controls"], the dialog, and the visible Close button.
- R23: raise max model calls from 5 to 8.
- New requirement: click allowlist of exactly four targets.
- New requirement: wait for the iframe and its content to load before snapshotting.
- Manifest: content script needs access to same-origin iframe; verify whether all_frames is required.

## Status
Phase 2: recon complete, amendments applied to 00-steering.md and 01-requirements.md
