---
'@plot-pm/board': patch
---

The Discovery tag cloud now reads tickets alongside stories: `extractTopics` takes the tracker's open and closed rows beside stories, a topic's `count` sums matches from both kinds into one denominator, and each topic entry carries the ticket numbers it matched (`ticketKeys`) beside story slugs. Topic terms also read a story's `objective` and `design` body text, not only its title and plan titles.
