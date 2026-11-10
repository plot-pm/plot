---
'plot': patch
---

The `watchFs` adapter re-arms a directory only when the path names a different directory or none. A rename of an entry inside the directory, such as git renaming a ref lock file, keeps the open watcher, because a close and re-open restarts the macOS FSEvents stream and changes in that gap were not delivered, for this directory and for the other directories watched in the same process.
