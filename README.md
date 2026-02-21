# Fallen London Favourites

A rewrite of [Playing Favourites](https://github.com/kav2k/fl_favourites) by [Alexander Kashev](https://github.com/kav2k)

Mark storylets, branches and cards as favourite or avoided in Fallen London. Favourites rise to the top, avoided sink to the bottom.

## Features

- Green/red highlights on favourite and avoided choices
- Automatic reordering: favourites up, avoided down (configurable)
- Click protection on avoided choices: off, hold Shift to bypass, or confirmation click (long press on mobile)
- Two click modes: cycle through states, or click/Ctrl+Click (tap/long press on mobile)
- Import/export your favourites and settings as a JSON file
- Settings sync across devices via Chrome Sync / Firefox Account
- Migration from other FL Favourites forks — import raw storage dumps through the same Import button
- Firefox for Android supported

<p>
<img src="store-assets/screenshots/01-readme-fave.png" alt="Favourite storylets highlighted in green" width="420">
<img src="store-assets/screenshots/02-readme-avoid.png" alt="Avoided storylets highlighted in red" width="420">
</p>

<p>
<img src="store-assets/screenshots/03-readme-cards.png" alt="Cards with favourite and avoid status, click protection" width="420">
<img src="store-assets/screenshots/05-mobile-storylets.jpg" alt="Storylets on Firefox for Android with click protection" width="220">
</p>

<img src="store-assets/screenshots/04-options.png" alt="Options page with Fallen London theme" width="540">

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/fallen-london-favourites/jkaoljkdjoecocmlnncdljoeeijlcjao)
- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/fallen-london-favourites/) (desktop and Android 142+)
- [Documentation](https://gasovn.github.io/fallen-london-favourites/)

## Development

Built with [WXT](https://wxt.dev/), TypeScript, Vite.

```bash
pnpm install
pnpm dev              # dev mode with hot reload
pnpm build            # Chrome production build
pnpm build:firefox    # Firefox production build
pnpm zip              # package for Chrome Web Store
pnpm zip:firefox      # package for Firefox AMO
pnpm test             # run tests
pnpm lint             # ESLint
pnpm format           # Prettier
```

## Feedback

Found a bug or have a suggestion? [Open an issue](https://github.com/gasovn/fallen-london-favourites/issues)

## License

MIT — see [LICENSE](LICENSE)
