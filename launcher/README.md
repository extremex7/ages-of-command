# Desktop launcher and installer

The desktop build wraps the unchanged browser game in a small native program, so players can
install it and start it from a shortcut without Node.js or a terminal.

## How it works

`AgesOfCommand` (Go, standard library only, about 7 MB) does four things:

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
   - `POST /api/ping` is the page's heartbeat, sent every 5 s.
   Each key is a file `store/<key>.dat` (characters outside `A-Z a-z 0-9 . _ -` are escaped as
   `~xx`), written to a temporary file and renamed so a crash never leaves half a save. Writes are
   limited to 256 MB. In a browser (dev server or any static host) the API is missing and the
   game keeps using `localStorage` as before.
4. **Opens a window**: Edge, Chrome, Brave or Chromium in app mode (`--app=<url>`, no tabs or
   address bar) with its own profile, so the window behaves like a program. With none of them it
   opens the default browser. It exits when the window closes and the page stops pinging, or
   after a minute without a ping (a closed tab in the default browser), or if the page never
   loads within 3 minutes.

Data folders: saves, settings and `launcher.log` go to `-data DIR` if given; else to a `userdata`
folder next to the program if one exists (the portable zip ships one); else to the user config
folder (`%APPDATA%\AgesOfCommand`, `~/Library/Application Support/AgesOfCommand`,
`~/.config/AgesOfCommand`). The window's browser profile is a cache and goes to the user cache
folder (`%LOCALAPPDATA%\AgesOfCommand\browser` on Windows) unless a data folder was chosen.

Options: `-no-window` (only serve), `-port N`, `-data DIR`. On Windows the program is built as
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
| `AgesOfCommand-<v>-macos.tar.gz` | Run `start.command` (picks the Apple silicon or Intel build). Unsigned: the first time, right-click it and choose Open |

Requirements: Go 1.22+, `zip`, NSIS 3 (`makensis`, for the installer; on Debian/Ubuntu
`apt-get install nsis`), and optionally go-winres
(`go install github.com/tc-hib/go-winres@v0.3.3`) for the Windows icon and version
information. Everything cross-compiles from Linux. The packages contain `index.html`, `src/`,
`styles/`, `data/` and the Markdown docs; screenshots, tools and tests are left out.

`launcher/installer.nsi` is the installer script, `launcher/README.txt` the player-facing
readme copied into every package, and `tools/make_icon.py` draws `launcher/icon/` and
`styles/icon.png` (needs Pillow).

## Testing

- `node tests/browser/desktop.mjs http://127.0.0.1:47110/ <data dir>` against a running
  launcher (`AgesOfCommand -no-window -data <dir>`) checks that the game boots, a quicksave lands
  in `<dir>/store` and not in browser storage, and that it is listed and loads after a reload.
- The Windows installer was checked under Wine 9: silent install (`/S`), files, shortcuts and
  registry entries, the installed launcher serving the game and storing saves in
  `%APPDATA%\AgesOfCommand`, and the uninstaller removing everything but the saves. The
  windowed mode was checked on Linux with Chromium: the launcher opened the window, the page
  pinged, and closing the browser stopped the launcher.
- Not checked: a real Windows 10/11 PC with Edge (Wine has no Edge), macOS, and SmartScreen.
  The installer and program are not code-signed, so Windows SmartScreen shows "Windows protected
  your PC" on first run (More info, then Run anyway) and macOS Gatekeeper asks for a right-click
  Open.
