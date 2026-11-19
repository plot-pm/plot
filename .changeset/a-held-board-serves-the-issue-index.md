---
'plot': patch
---

A board whose snapshot protocol differs from a live fleetd's now serves the Tickets section from fleetd's `issues.json` and starts no process for it. It takes the issue source from the index's own `source` and `connector`, filters planned issues with the last plan read this board answered, and reads the reader from the identity and `People` directory it already holds. Before any plan read has answered, the section names that no issue can be called unplanned instead of "the tracker has not been read yet" (#3551).
