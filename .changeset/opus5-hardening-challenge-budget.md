---
"plot": minor
---

`challenge-the-plan` is now bounded. Three changes: a question budget (`Challenge question budget`, default 16, `0` disables), a material-vs-marginal filter applied before each question is asked, and a falsifiable stopping rule.

The previous completion check required "no more gaps detected in plan" — a condition that cannot be verified and therefore never fires. It is replaced by three independent stop conditions, any one of which ends the interview: the user says stop, the budget is exhausted, or a full round produces no answer that changes the plan's shape.

The category progression is now documented as a search order rather than a checklist, since five categories at four questions per round would exceed the budget. Skipping a category with no material questions is a correct outcome.

Works standalone: when `plot-config.sh` is absent (use outside a Plot project), the default budget applies rather than erroring.

Deletion pass, same change: removes 39 canned question templates, the tone/audience/complexity adaptation blocks, the narrative-weaving worked example, and the Adaptive Depth Strategy — 801 words of guidance that either prescribes taste or enumerates what the material-vs-marginal filter now covers. The skill goes from 1,654 to 1,412 words on main net of the additions.

<!--
bumps:
  skills:
    challenge-the-plan: minor
-->
