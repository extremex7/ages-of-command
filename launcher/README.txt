AGES OF COMMAND
===============

Start the game with AgesOfCommand (AgesOfCommand.exe on Windows, the "Ages of Command"
shortcut after installing, start.command on macOS, ./AgesOfCommand on Linux).

The game opens in its own window. On Windows it uses WebView2, the web engine built into
Windows 10 and 11; on Linux it uses WebKitGTK (installed with most desktops; on a minimal system
install libwebkit2gtk-4.1). Without them, and on macOS, it opens in Edge, Chrome, Brave or
Chromium as an app window, or in your default web browser. Closing the window stops the game.

Where your saves are kept
  Installed or Linux/macOS copies: your user settings folder
    Windows: %APPDATA%\AgesOfCommand\store
    macOS:   ~/Library/Application Support/AgesOfCommand/store
    Linux:   ~/.config/AgesOfCommand/store
  Portable copies keep them in the "userdata" folder next to the program, so the whole folder
  can be moved to a USB stick. Delete that folder to use the settings folder instead.
  launcher.log in the same place records what the launcher did, if something goes wrong.

Command line options
  -no-window   only serve the game; open http://127.0.0.1:47110/ in any browser yourself
  -browser     use a browser window instead of the built-in one
  -port N      use another local port (default 47110; the next nine are tried if it is busy)
  -data DIR    keep saves, settings and the log in DIR

The game only listens on this computer (127.0.0.1) and needs no internet connection.
Mods: the game's data files are plain JSON under game/data; see game/docs/MODDING.md.
