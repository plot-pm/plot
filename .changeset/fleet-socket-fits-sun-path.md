---
'plot': patch
---

fleetd binds its channel at `<repo>/.plot/fleet.sock` while that path is at most 103 bytes, the macOS `sun_path` limit less its NUL. A longer repository root binds `/tmp/plot-<uid>/<16 hex of sha256(realpath of the root)>.sock` instead, in a directory fleetd makes with mode 0700. fleetd, the board and the `plot-follow` mod's follower take the path from one rule, `rules/channel-address.ts`, through `bindableChannelAddress` and `channelAddressFor`, so every client finds the socket fleetd bound. A per-user directory that is a symbolic link, belongs to another uid, or is open to others refuses the bind with a named error, fleetd runs without the channel, and the board and the follower do not connect.
