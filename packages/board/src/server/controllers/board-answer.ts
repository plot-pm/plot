import { type BuildBoardOptions, storyTopicInput } from '../board.js';
import { planRefAgeSeconds, ticketLaneData } from '../fleet.js';
import { discoveryLanes } from '../discovery-lanes.js';
import { extractTopics } from '../topics.js';
import { serverInfo } from '../server-info.js';
import { boardQueryFor, type Estate } from '../estate.js';
import { dispatchAvailability } from '../dispatch.js';
import { approveAvailability } from '../approve.js';
import { continueAvailability } from '../continue.js';
import { restartAvailability } from '../restart.js';
import { ideaAvailability } from '../idea.js';
import { interrogateAvailability } from '../interrogate.js';
import { resliceAvailability } from '../reslice.js';
import { deliverAvailability } from '../deliver.js';
import { implementAvailability } from '../implement.js';
import { dropAvailability } from '../drop.js';
import { storyAvailability } from '../story.js';
import { boardState } from './fleet-state.js';

/**
 * The `/api/board` payload: the estate's board plus the facts only this server
 * knows. Returns a value, so a test calls it without a server.
 *
 * @param opts the board options
 * @param estate where the board reads the estate from
 * @param host the interface the server bound to (`HOST`)
 * @param port the port the server bound
 * @param archived whether the Discovery tab asked for archived rows
 */
export const boardAnswer = async (
  opts: BuildBoardOptions,
  estate: Estate,
  host: string,
  port: number,
  archived: boolean,
) => {
  // Whether Start work will act is a fact about this SERVER's binding, not
  // about any plan, so it is attached here — where the binding is known —
  // rather than threaded through the plan walker. `server` rides along for
  // the same reason and needs the same fact: how to start this board again
  // and where it listens, carried on the last successful poll so the page
  // still holds it once nothing is answering.
  // PARSE, CALL, ENRICH, SERIALISE — and the estate reading is all in the
  // call. `boardState` is the controller: it answers *what is on the
  // board*, and it does so with no `host`, no port and no request, which
  // is what lets the master agent ask the same question.
  //
  // WHAT STAYS HERE IS WHAT ONLY THIS CALLER KNOWS. `server` is transport
  // knowledge — which port did this process bind, and how would you start
  // it again — and the capability flags below are the same kind of fact
  // wearing a lifecycle name: every one of them answers *did this request
  // come from this machine?*, which is meaningless to a caller that never
  // made a request. A controller returning them would have to invent a
  // binding for the master agent, so they enrich rather than descend.
  //
  // They stay TEN separate fields rather than one. Today every flag gives
  // the same answer; one flag serving several capabilities is precisely
  // how they diverge when a later change makes only one of them local.
  const built = await boardState(boardQueryFor(opts, estate));
  // The SAME cache `discoveryLanes` reads from, asked once here and once
  // there: a raw read, before `ticketLanes` groups it into Open/In
  // progress/Done, because the topic cloud wants every tracker row's
  // `number`/`title` and does not care which lane it fell in. Null where
  // `discoveryLanes` would also find no cache — `boardState`'s topics
  // (stories only, no tickets) stand in, same as its `tickets: null`.
  const ticketData = await ticketLaneData(opts);
  return {
    ...built,
    // The fleet's own cache, not `built.planSource`: the ref and its age
    // come from the same read, but `boardState` has no reason to depend on
    // `fleet.ts`'s cache for a field it never otherwise needs.
    planRefAgeSeconds: planRefAgeSeconds(opts),
    dispatch: dispatchAvailability(host),
    server: await serverInfo(opts, port),
    approve: approveAvailability(host),
    continue: continueAvailability(host),
    restart: restartAvailability(host),
    idea: ideaAvailability(host),
    interrogate: await interrogateAvailability(host, opts),
    reslice: resliceAvailability(host),
    deliver: deliverAvailability(host),
    implement: implementAvailability(host),
    drop: dropAvailability(host),
    story: storyAvailability(host),
    // D7's Discovery lanes. `archived` reflects the TAB'S own toggle, read
    // off this request's query string — not `?released=1`, which Planning
    // owns. Computed here rather than inside `boardState`: the cache
    // `ticketLaneData` reads lives in `fleet.ts`, and `boardState` has no
    // dependency on it today.
    ...(await discoveryLanes(opts, built, archived)),
    // Recomputed with tickets folded in, for the same reason `tickets`
    // itself is: `boardState`'s own `topics` (above, spread first) saw
    // stories alone. A topic found only in ticket titles — no story, no
    // plan — still needs a chip, which `boardState` cannot supply.
    ...(ticketData && {
      topics: extractTopics(
        built.stories.map((s) => storyTopicInput(s)),
        [...ticketData.open, ...ticketData.closed].map((t) => ({ number: t.number, title: t.title })),
      ),
    }),
  };
};
