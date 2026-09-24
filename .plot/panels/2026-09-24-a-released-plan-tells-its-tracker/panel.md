# Panel moderation — a-released-plan-tells-its-tracker

**Reconciliation: `amend` — estate.**

**The conclusion survives and the evidence does not.** The juror separated those cleanly, and the distinction is the verdict's value.

## A blocking finding: the port takes a PR, not an issue

`ports/tracker.ts:41-46` — verified by the moderator:

```ts
export interface StatusWrite {
  /** The pull request the status is about, as its address. */
  prUrl: string;
  status: string;
}
```

**The plan assumed `statusWrite` addresses an issue.** So *"nothing new is built there"* is false, and **slice 2 as written cannot be built against the port it names.** Whether `StatusWrite` gains an issue address or the port gains a second operation is now an Open Question settled before the slice is scoped — a port change, not a caller.

## Three of four numbers recounted wrong

| drafted | measured |
|---|---|
| 322 plans | **331** |
| 23 name an issue | **33** |
| 22 released name one | **18** |
| 7 open tickets | **10** |
| 1 miss → #935 | **held** |

**Every error moves against the plan's case per capita**, so the juror's framing is right: *a correction, not a refutation*. But **a plan whose stated evidence is three-quarters wrong cannot be approved on that evidence.**

## The gap is confirmed harder than the plan claimed

Zero production callers of `statusWrite`; zero `tracker|issue` matches across five lifecycle files; `git log -S` shows the port's construction and no prior attempt. **No sibling arm already ships it** — unlike four other plans panelled today.

## The disposition

**Amend before building.** The defect is real and unimplemented. What changes: the numbers, two citations off by a directory and a line, and a port decision the slice must make first.
