# Pickleball Fixtures

An offline-first Progressive Web App for a pickleball club convenor. On a phone or
tablet at the venue: build today's list from the names who said they would come
(the club has 60+ members, so the roster is never shown as a list to pick from),
tick people off as they arrive, and get 12 rounds of 10-minute doubles fixtures
across the courts in use, regenerated live as people arrive late or leave early.

Live: **https://keendeli.github.io/pickleball-fixtures/**

No backend, no accounts, no analytics. All state lives in `localStorage` on the
device (one versioned JSON document). The club roster persists across sessions.
Install it to the home screen and it works with no signal.

## Install to the home screen

Open the live URL in the browser and use the small **Add to home screen** link
at the bottom of the Start screen. On Android and desktop Chrome/Edge it opens
the browser's install dialog; on iPhone/iPad it shows the Safari steps (Share,
then "Add to Home Screen"), because Safari has no install prompt. The link is
only shown in a browser tab: it disappears once the app is installed, and
browsers with no install path (Firefox, desktop Safari) never see it. The
installed app runs standalone, full-screen, and offline.

## Venues

Venues are fixed in code (`src/lib/venues.ts`):

| id      | Venue                               | Courts |
| ------- | ----------------------------------- | ------ |
| `vyc`   | Vonda Youngman Centre               | 2      |
| `tmshs` | Tamborine Mountain State High School | 3      |

## Rules

- Doubles only: four players per court, two pairs. Partners rotate every round.
- Rounds are time based, no scores. Default 12 rounds of 10 minutes; both are
  editable when starting a session.
- Courts used per round = `min(venue courts, floor(active players / 4))`.
  Tamborine has 3 courts but with 11 players only 2 are used; with 7 only 1.
  With fewer than 4 active players no court is used and the screen says so.
- Everyone not on a court sits out that round.
- Fairness priorities, in order: equalise games played across the session,
  avoid repeating a partner, avoid repeating an opponent.
- A round that has been started or finished is frozen. When attendance changes,
  only rounds not yet started are recomputed, carrying forward games played
  and partner/opponent history from the frozen rounds.
- **Removing a player from the current round** (Left on the Rounds screen,
  un-ticking Arrived or ✕ on Check-in, or a Rest that applies to this round)
  takes effect now, even mid-round, with minimal disruption: if the court
  count is unchanged, every other assignment stays put and the best available
  sitter (fewest games, then who sat out most recently) fills the vacated
  slot. If the court count drops (8 on 2 courts becomes 7 on 1), the round is
  re-solved for the remaining players with a preference for keeping existing
  pairs together. Players who moved onto a court or team they were not on
  before are highlighted in amber with an "IN" marker on the Rounds and
  Display screens so the convenor can call out the change. The marks clear
  when the round finishes or a later arrival regenerates a not-yet-started
  round. Locked rounds get the same treatment: the lock keeps everything else.
- "Rest" applies to one round and then clears. "Left" removes a player from
  the current round onward and can be undone from Check-in; a player who
  leaves during a round is recorded as having last played the previous one.
- The convenor can swap any two players within a round (including someone
  sitting out) and lock a round so regeneration leaves it alone. A swap on a
  not-yet-started round locks it automatically, otherwise the next
  regeneration would undo it.

## How the scheduler decides

`src/lib/scheduler.ts` is pure TypeScript with no DOM or storage dependency.

1. **Who is active** for round *n*: arrived, has not left before *n*, and is not
   resting for *n*.
2. **Courts used**: the formula above.
3. **Who plays**: players are ranked by fewest games played so far, then by who
   sat out most recently (so sit-outs are spread evenly and nobody sits twice
   in a row while others have not sat at all), then a seeded random
   tie-break. The top `4 × courts` play; the rest sit.
4. **Pairing**: the playing set is arranged into courts and pairs by a small
   local search: several random arrangements, each improved by swapping any two
   positions while that lowers the penalty. Penalty = 10 per repeated partner
   pairing + 3 per repeated opponent pairing, summed over history. The lowest
   penalty arrangement wins.
5. **Regeneration**: the whole schedule is rebuilt from the facts (attendees +
   frozen rounds + seed). Frozen rounds are returned untouched; pending rounds
   are recomputed. The rebuild is run from a handful of seeds and the schedule
   with the lowest total penalty is kept, which is what gets 8 players through
   7 rounds with no repeated partner.
6. **Substitution**: before the rebuild, the store checks the current round
   and every later frozen round for players who are no longer active. Each
   such round goes through `substituteInRound`, which fills vacated slots (or
   re-solves the round with a pair-keeping penalty of 4 per split pair when
   the court count changes) and records the fillers in `round.substituted`.
   The current round is then held for that rebuild even if it is pending and
   unlocked, so the substitution is what the convenor sees.

Everything is deterministic for a given seed, so the tests are stable and
toggling a player off and on again gives the same fixtures back.

## Screens

1. **Start** — three numbered steps on one page: (1) pick a venue, set rounds
   and minutes; (2) build **today's players**: type a name and pick it from
   the roster type-ahead (or add it as a new player), then tap Arrived against
   each person as they turn up; ✕ takes someone off today's list without
   touching the roster, and Clear list (with a one-tap confirm) empties it;
   (3) "Start session with M arrived". Today's list is saved on the device, so
   the convenor can build it the night before from TeamReach and open the app
   at the venue. On start, everyone on the list becomes an attendee, those
   ticked go straight into round 1 and the rest are Expected at Check-in; the
   list is then cleared. Offers Resume if a session is stored. A small link
   opens the Roster screen for renames and removals.
2. **Check-in** — type-ahead add from the roster (a new name is added to the
   roster), big Arrived toggles, counts of arrived / on court / sitting for the
   current round. Players can be added and ticked at any time during the session.
3. **Rounds** — "Round N of M", one card per court in use, a Sitting out strip,
   and a countdown with Start / Pause / Next round. Tap a name to swap, rest
   next round, or mark as left. Earlier rounds are viewable read-only.
4. **Display** — full-screen large-type view of the current round and timer for
   a tablet on a table. Requests the Screen Wake Lock where supported. Tap
   anywhere (or press Escape) to exit.

The timer is driven by a stored end timestamp, not an accumulating interval, so
it survives screen lock and backgrounding. At zero it plays a short synthesised
beep (Web Audio, no asset) and vibrates where supported.

## Run locally

```sh
npm ci
npm run dev        # http://localhost:5173/pickleball-fixtures/
npm test           # vitest
npm run check      # svelte-check + tsc
npm run build      # production build into dist/
npm run preview    # serve dist/ (service worker and manifest included)
npm run icons      # regenerate the PNG icons in public/
```

Stack: Vite, Svelte 5 (runes), TypeScript, vite-plugin-pwa (Workbox, auto
update), Vitest.

## Deploys

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) runs
`npm ci`, `npm test`, `npm run check`, `npm run build`, uploads `dist/` as a
Pages artifact and deploys it. GitHub Pages is configured with the
"GitHub Actions" build type; nothing is served from a branch. Vite's `base` is
`/pickleball-fixtures/` so assets and the service worker resolve on Pages.

## Data model

Stored facts only; anything derivable is recomputed. See `src/lib/types.ts`:
`Player`, `Venue`, `Session` (attendees with `arrived`, `leftAfterRound`,
`restingRound`; rounds with `status`, `locked`, `courts`, `sitting`,
`substituted`, `endsAt`) and `today` (the Start screen's draft list of
`{ playerId, arrived, arrivedAt? }`). The document carries a `schemaVersion`
(currently 2; v1 documents gain an empty `today` and empty `substituted`
arrays on load).
