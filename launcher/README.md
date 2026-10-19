# Desktop launcher and installer

The desktop build wraps the unchanged browser game in a small native program, so players can
install it and start it from a shortcut without Node.js or a terminal.

## How it works

`AgesOfCommand` (Go, about 7 MB; its one dependency is go-webview2 for the Windows window) does
four things:

1. **Finds the game files**: `game/` next to the program (installed and packaged layouts), the
   program's own folder, any parent folder (a source checkout), then the working folder. A
   folder counts when it has `index.html` and `data/map/world.json`.
2. **Serves them on 127.0.0.1** at port 47110, or the next free port up to 47119. Requests whose
   `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` get 403, so other web pages
   cannot reach the store through DNS rebinding. If the port already runs this game (a second
   launch), it only opens another window and exits.
3. **Keeps saves on disk** through a small store API that `src/ui/storage.js` uses when
   `/api/info` answers `{"app":"ages-of-command"}`:
   - `GET /api/store` returns every key and value (read once at start-up);
   - `PUT`, `GET` and `DELETE /api/store/<key>` write, read and remove one key;
   - `POST /api/ping` is the page's heartbeat, sent every 5 s;
   - `POST /api/window` with `{"mode": "windowed" | "maximized" | "fullscreen", "width", "height"}`
     changes the native window (the Settings screen's window mode and size; 501 when the game is
     in a browser window). `/api/info` says `"window": "native"` or `"browser"`.
   Each key is a file `store/<key>.dat` (characters outside `A-Z a-z 0-9 . _ -` are escaped as
   `~xx`), written to a temporary file and renamed so a crash never leaves half a save. Writes are
   limited to 256 MB. In a browser (dev server or any static host) the API is missing and the
   game keeps using `localStorage` as before.
4. **Opens a window**, trying in order:
   - a native window with the system's web engine: WebView2 on Windows (the Edge engine built
     into Windows 10 and 11; `window_windows.go`, using github.com/jchv/go-webview2, which needs
     no DLL) or WebKitGTK on Linux (`window_linux.go`, cgo; GTK 3 and WebKitGTK 4.1 or 4.0 are
     loaded at run time, so the program still starts without them). The program exits when the
     window closes;
   - Edge, Chrome, Brave or Chromium in app mode (`--app=<url>`, no tabs or address bar) with
     its own profile, or the default browser. These are the fallback when no native window can
     be opened (macOS for now, or `-browser`). The program then exits when the window closes and
     the page stops pinging, after a minute without a ping (a closed tab), or if the page never
     loads within 3 minutes.

Data folders: saves, settings and `launcher.log` go to `-data DIR` if given; else to a `userdata`
folder next to the program if one exists (the portable zip ships one); else to the user config
folder (`%APPDATA%\AgesOfCommand`, `~/Library/Application Support/AgesOfCommand`,
`~/.config/AgesOfCommand`). The window's browser profile is a cache and goes to the user cache
folder (`%LOCALAPPDATA%\AgesOfCommand\browser` on Windows) unless a data folder was chosen.

Options: `-no-window` (only serve), `-browser` (browser window instead of the native one), `-port N`, `-data DIR`. On Windows the program is built as
a GUI program (no console window) and shows errors in a message box.

## Building

```bash
tools/build_desktop.sh [version]     # default version: package.json
```

writes to `build/desktop/`:

| File | What it is |
| --- | --- |
| `AgesOfCommand-<v>-windows-setup.exe` | Installer: per user, no admin rights, Start menu and optional desktop shortcut, Add/Remove Programs entry, uninstaller that keeps saves unless asked |
| `AgesOfCommand-<v>-windows-portable.zip` | Unzip anywhere and run `AgesOfCommand.exe`; saves stay in its `userdata` folder |
| `AgesOfCommand-<v>-linux-x64.tar.gz` | Run `./AgesOfCommand` |
| `AgesOfCommand-<v>-macos.tar.gz` | Run `start.command` (picks the Apple silicon or Intel build). Opens a browser window, not a native one. Unsigned: the first time, right-click it and choose Open |
| `AgesOfCommand-<v>-android.apk` | The Android app (see android/README.md), built when its tools are installed |

Requirements: Go 1.22+, a C compiler (the Linux build uses cgo), `zip`, NSIS 3 (`makensis`, for the installer; on Debian/Ubuntu
`apt-get install nsis`), and optionally go-winres
(`go install github.com/tc-hib/go-winres@v0.3.3`) for the Windows icon and version
information (`launcher/winres/winres.json`; the native window uses icon resource 1). Everything cross-compiles from Linux. The packages contain `index.html`, `src/`,
`styles/`, `data/` and the Markdown docs; screenshots, tools and tests are left out.

`launcher/installer.nsi` is the installer script, `launcher/README.txt` the player-facing
readme copied into every package, and `tools/make_icon.py` draws `launcher/icon/` and
`styles/icon.png` (needs Pillow).

## Testing

- `node tests/browser/desktop.mjs http://127.0.0.1:47110/ <data dir>` against a running
  launcher (`AgesOfCommand -no-window -data <dir>`) checks that the game boots, a quicksave lands
  in `<dir>/store` and not in browser storage, and that it is listed and loads after a reload.
- The Windows installer was checked under Wine 9: silent install (`/S`), files, shortcuts and
  registry entries, the installed program serving the game and storing saves in
  `%APPDATA%\AgesOfCommand`, and the uninstaller removing everything but the saves. Wine has no
  WebView2, so there it falls back to the browser window, which was checked too.
- The Linux native window was checked under Xvfb: it opens the game in WebKitGTK, a new game
  can be started and played, and Ctrl+S writes the save to `~/.config/AgesOfCommand/store`. The
  browser fallback was checked with Chromium (the program stops when the window closes).
- Not checked: the WebView2 window on a real Windows 10/11 PC, and macOS. The installer and
  program are not code-signed, so Windows SmartScreen shows "Windows protected your PC" on first
  run (More info, then Run anyway) and macOS Gatekeeper asks for a right-click Open.
