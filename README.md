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

## Desktop builds

The Electron desktop app bundles the interpreter but not third-party games. It
stores imported and downloaded games under the operating system's application
data directory, keeping game files and saves writable and separate from the
installed app.

Install dependencies with `npm install`, then build on the target operating
system:

```sh
npm run dist:mac
npm run dist:win
```

`dist:mac` produces macOS DMG and ZIP packages for Intel and Apple silicon;
`dist:win` produces a Windows installer and portable executable for x64. Build
each platform on its own OS (macOS for Mac releases and Windows for Windows
releases). Outputs go to `release/`. For distribution outside personal use,
sign/notarize the macOS app and sign the Windows installer.

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
