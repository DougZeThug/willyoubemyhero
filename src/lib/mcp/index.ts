import { defineMcp } from "@lovable.dev/mcp-js";
import getActiveEvent from "./tools/get-active-event";
import listRoster from "./tools/list-roster";
import getLeaderboard from "./tools/get-leaderboard";
import getAllTimeRecords from "./tools/get-all-time-records";
import listAwards from "./tools/list-awards";

// No `auth`: these tools read only what any visitor to the site can already
// see, through the anon role. Nothing here touches member codes, admin state,
// card collections or votes — those stay behind the app's own guards.
export default defineMcp({
  name: "combine-champion",
  title: "Combine Champion",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Will YOU Be My Hero? draft combine. Use `get_active_event` for the current combine and its stations, `list_roster` for who is running, `get_leaderboard` for this year's official times, `get_all_time_records` for the fastest runs ever, and `list_awards` for superlatives. Times are milliseconds; each row also carries a formatted `time`.",
  tools: [getActiveEvent, listRoster, getLeaderboard, getAllTimeRecords, listAwards],
});
