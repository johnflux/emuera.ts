# Emuera.ts

A browser-based interpreter for Emuera/ERB games, written in TypeScript.
It hot-patches the game for UI improvements and speed.

![Emuera.ts gameplay screenshot](docs/main_screenshot.png)

![Emuera.ts game library screenshot](docs/game_select_screenshot.png)

## Get started

Requires Node.js 22.6 or newer.

```sh
npm install
npm start
```

Open [http://127.0.0.1:3003](http://127.0.0.1:3003) in your browser. Add games
under `GAMES/`, then choose **Refresh library** in the app.
I recommend starting with:

https://gitgud.io/Legis1998/anon-tw/-/archive/anon-tw_eng-modding/anon-tw-anon-tw_eng-modding.zip

(On macOS, use `unar` to extract the ZIP file to preserve Japanese filenames)

See the [developer guide](docs/developer-guide.md) for compatibility details and
additional documentation.

With the game input focused, press Up/Down to browse typed inputs and clicked commands.
Going past the newest entry restores your unfinished input. History lasts until
the page is reloaded. Recalled commands show their button label as a non-editable
hint (for example, `400 [Move]`); editing the input hides the hint.

## Translation and clipboard

Both options below are off by default and available in the menu:

- **Auto-copy game text** copies the latest printed output as plain text, before
  translation, for tools such as Luna Translator. Desktop builds use the native
  clipboard; browser builds need clipboard permission and may require focus.
- **Translation model…** configures a local OpenAI-compatible server. In LM
  Studio, load your model (for example Gemma 3 12B), start its API server, set the
  base URL to `http://127.0.0.1:1234/v1`, and use **Load models** to select its ID.
  Save, then turn on **Local-model translation**. Translations appear below the
  game output without changing game buttons or saves. Original text is sent only
  to the configured localhost server. New output cancels an outdated translation.

These settings are saved in the current browser. Local-model translation uses
separate settings from character chat and disables the browser's on-device
translation when switched on. **Translate Japanese** remains available for
browsers with the on-device Translator API.

## Desktop builds

The Electron desktop app bundles the interpreter but not third-party games.
The Windows ZIP build looks for games in `GAMES/` beside the executable and in the
app's application-data directory (`%APPDATA%\era-typescript\GAMES` on Windows).
Extract the whole ZIP to a writable folder, then run `emuera-ts.exe`. On first launch,
it automatically downloads and extracts eraToho The World into the adjacent
`GAMES/` folder using the same installer as the library button. An existing TW
installation in either location is kept; nothing is overwritten. Failed downloads
show an error and can be retried from the library or by restarting the app.
Other game downloads also go beside `emuera-ts.exe`; Mac downloads still use application
data. If the same game is in both locations, the download location takes precedence. Refresh the library
after adding games manually. Saves remain in each game's normal save directory.

Install dependencies with `npm install`, then build on the target operating
system:

```sh
npm run dist:mac
npm run dist:win
```

`dist:mac` produces macOS DMG and ZIP packages for the Mac's native architecture;
`dist:win` produces `EraTs-<version>-win-x64.zip` containing the Windows x64 app;
there is no Windows installer or self-extracting executable. Build
on the target OS and architecture: the graphics libraries need platform-specific
native bindings, so a Windows package built with Mac dependencies will not run.
Use `dist:mac:x64` on an Intel Mac or `dist:mac:arm64` on Apple silicon.
Packaging rejects mismatched targets and checks that the native libraries load.
Outputs go to `release/`. For distribution outside personal use,
sign/notarize the macOS app and sign the Windows executable.

To build and publish a GitHub Release automatically, first commit your changes,
then run:

```sh
npm run release -- patch
git push --follow-tags
```

Use `minor`, `major`, or an explicit version such as `0.2.0` instead of `patch`
as needed. The release command updates `package.json` and `package-lock.json`,
commits them, and creates a matching tag such as `v0.1.1`. It requires a clean
working tree. Pushing the tag triggers GitHub Actions to build Windows and macOS
packages and attach them to a GitHub Release. Package filenames use that version.
The workflow uses separate Windows x64, macOS Intel, and macOS Apple-silicon
runners and checks native bindings inside each packaged app before publishing.
The command does not push anything automatically.

To run the desktop app during development, use `npm run desktop`. This builds
the server and opens the app window.

## Save files

The app reads and writes Emuera's native binary saves, including gzip-compressed
saves. Existing slots appear in the game's normal load menu without importing
or moving files.

It follows the game's `emuera.config`: saves live in `sav/` when
`セーブデータをSAVフォルダ内に作成する:YES`, otherwise in the game directory.
Slots use `save00.sav`, `save01.sav`, etc.; global data uses `global.sav`.
Character exports use `dat/chara_<name>.dat`.

**Back up your saves before switching engines.** Saving or deleting a slot here
affects the same files Emuera uses. Do not run both engines against the same
saves simultaneously. Older text-format Emuera saves and this app's previous
JSON saves are not supported.

## License

The original Emuera.ts project source is licensed under the [BSD 3-Clause
License](LICENSE.md). Bundled games and third-party assets are excluded and
remain subject to their respective licenses and terms.
