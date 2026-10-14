---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

Selecting a topic chip on the Discovery tab narrows the ticket lanes by the topic's `ticketKeys` as well as the story lanes by its `storySlugs`, and a lane the topic emptied says that the topic hides its rows. The domain's new `lanesForTopic` decides which rows survive.
