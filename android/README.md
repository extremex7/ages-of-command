# Android app

`tools/build_android.sh` turns the game into an Android app (`AgesOfCommand-<v>-android.apk`,
about 1.6 MB, Android 7.0 or newer). It is the same game as the desktop and browser versions:
the files in `index.html`, `src/`, `styles/` and `data/` are packed into the APK's
`assets/game/` folder and shown full screen, in landscape, in the phone's own WebView (the
Chrome engine that Android keeps up to date).

## How it works

`src/com/agesofcommand/game/MainActivity.java` is the whole app:

- **Serving the game.** Pages load from `https://appassets.androidplatform.net/`, a host Android
  reserves for app content. The WebView asks the app for every file and the app answers from the
  APK's assets with the right content type, so ES modules and `fetch()` work as on a web server.
  Requests anywhere else are refused; the app never goes online.
- **Saves.** The page gets an `AOCNative` object (`info()`, `all()`, `put(key, value)`,
  `remove(key)`). Each key is a file `files/store/<key>.dat` in the app's private storage, named
  like the desktop launcher's files and written to a temporary file then renamed.
  `src/ui/storage.js` uses it when present. Saves survive app updates; uninstalling the app
  deletes them (Android removes an app's private files).
- **Phone behaviour.** Full screen with the system bars hidden, landscape only. The Back button
  closes the open dialog or clears the selection; pressing it twice quickly leaves. The game
  pauses when the app goes to the background.
- **Touch** (in `src/ui/client.js`, so it works in any touch browser too): drag with one finger
  to move the map, pinch with two to zoom, tap to select, and press and hold to give an order
  (what right-click does with a mouse).

## Building

No Gradle or Android Studio is needed. On Debian or Ubuntu:

```bash
apt-get install android-sdk-platform-23 dalvik-exchange aapt zipalign apksigner openjdk-17-jdk-headless
tools/build_android.sh [version]
```

The app compiles against the API 23 platform jar from those packages (Google's own SDK downloads
were not reachable when this was set up), targets API 34 and needs API 24. `tools/build_desktop.sh`
calls it too when the tools are installed.

**Signing key.** The first build creates a key at `$AOC_KEYSTORE` (default
`~/.aoc/android-release.jks`, password `$AOC_KEYSTORE_PASS`). Keep that file: Android installs an
update over an existing install only when both are signed with the same key. It is not in the
repository.

## Installing on a phone

Copy the APK to the phone and open it. Android asks once to allow installs from the app you
opened it with (Files, Chrome, Drive...). Play Protect may warn that the app is from an unknown
developer; choose to install anyway. Publishing on Google Play would need a developer account and
an Android App Bundle built with Google's tools.

## Tested and not tested

- `node tests/browser/mobile.mjs` runs the game in Chromium as a touch-screen phone held sideways
  (846×390), with a stand-in for `AOCNative`: one-finger pan, pinch zoom, tap to select, long
  press to order, saves through the bridge, and pausing in the background.
- The APK is checked with `aapt dump badging` and `apksigner verify`, and its file list against
  the game folder.
- **Not yet run on a phone or emulator** (Google's emulator images could not be downloaded here).
- The interface is the desktop one made denser on short screens; a proper phone layout with
  larger touch targets is part of the interface work still to do.
