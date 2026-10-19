AGES OF COMMAND
===============

Start the game with AgesOfCommand (AgesOfCommand.exe on Windows, the "Ages of Command"
shortcut after installing, start.command on macOS, ./AgesOfCommand on Linux).

The launcher opens the game in its own window using Microsoft Edge, Google Chrome, Brave or
Chromium, whichever is installed (every Windows 10 and 11 PC has Edge). If none is found it
opens your default web browser instead. Closing the game window also stops the launcher.

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
  -port N      use another local port (default 47110; the next nine are tried if it is busy)
  -data DIR    keep saves, settings and the log in DIR

The game only listens on this computer (127.0.0.1) and needs no internet connection.
Mods: the game's data files are plain JSON under game/data; see game/docs/MODDING.md.
