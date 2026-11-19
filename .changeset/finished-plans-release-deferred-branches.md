---
'plot': patch
---

`loose-delete` no longer refuses `named` for a branch whose only naming slice is in a Released, Superseded or Rejected plan, so the controller agrees with the Delivery tab's loose placement. One domain rule, `planNamesBranch`, decides both, and the fleet scan drops finished plans through the same condition. A planless branch whose PR the host closed now reads "PR closed without merging" instead of "commits, no PR ever opened".
