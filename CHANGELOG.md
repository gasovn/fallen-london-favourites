# Changelog

## 0.7.0 — 2026-02-19

- Import/export favourites and settings via JSON file
- Click protection reworked: three modes (off / shift / confirm) instead of a single checkbox
- Storage migration from old block_action format

## 0.6.4 — 2026-02-17

- Click protection "SURE?" on avoided and faved cards
- Long press to avoid on mobile, touch bypass for blocked buttons
- Cancel long press when finger moves during scroll
- Options page redesign with Fallen London dark theme
- Fix wrapObserver losing track of #main when React replaces it
- Fix protectAvoids not triggering when clicking button padding
- Unified extension naming and store descriptions
- Tests for cards and platform modules

## 0.6.3 — 2026-02-15

- Firefox for Android support (minimum version 142)
- Fix card discard button not blocking on mobile

## 0.6.2 — 2026-02-15

- Fix Fifth City Stories storylets not being detected

## 0.6.1 — 2026-02-15

- Fix user data being lost on extension update

## 0.6.0 — 2026-02-15

- Initial release: rewrite of Playing Favourites
- Favourite/avoid for storylets, branches and cards
- Automatic reordering with configurable behaviour
- Click protection on avoided choices
- Settings sync via Chrome Sync / Firefox Account
