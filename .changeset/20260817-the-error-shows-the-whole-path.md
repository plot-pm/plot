---
---

board: the PR error shows the whole path

`slice(0, 80)` cut the failure message mid-path, and cut it **silently**:

```
Command failed: bash /Users/…/plot/skills/plot/script
                                                    ↑ no ellipsis
```

`…/skills/plot/script` reads like a filename and names a file that does
not exist, so a message whose only job is to point at a cause pointed at
a fiction. Measured cost: one wrong lookup before finding
`plot-host.sh`.

The limit is removed rather than raised — any limit moves the same defect
to the next longer path — and the footer wraps instead. It costs a line
of height on the rare occasion the board cannot reach the host, which is
the one moment the reader is owed the whole sentence.

<!--
bumps:
  skills:
    plot: patch
-->
