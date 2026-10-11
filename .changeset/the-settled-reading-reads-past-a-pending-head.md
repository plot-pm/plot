---
'plot': patch
---

A red default branch no longer holds the fleet's queue while new commits keep landing on it. When the head's CI is still running, fleetd now asks the runs of the commits between the head and the settled commit, newest first, at most five per refresh, and moves the settled reading to the newest one that has concluded.
