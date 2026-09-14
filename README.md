# Pickleball Fixtures

An offline-first Progressive Web App for a pickleball club convenor. On a phone or
tablet at the venue: enter who said they would come, tick people off as they
arrive, and get 12 rounds of 10-minute doubles fixtures across the courts in use,
regenerated live as people arrive late or leave early.

Live: **https://keendeli.github.io/pickleball-fixtures/**

No backend, no accounts, no analytics. All state lives in `localStorage` on the
device (one versioned JSON document). The club roster persists across sessions.
Install it to the home screen and it works with no signal.

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
- "Rest" applies to one round and then clears. "Left" removes a player from
  every later round (and can be undone from Check-in).
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

Everything is deterministic for a given seed, so the tests are stable and
toggling a player off and on again gives the same fixtures back.

## Screens

1. **Start** — three numbered steps on one page: (1) pick a venue, set rounds
   and minutes; (2) tick who is coming today from the club roster shown inline,
   adding new names as needed; (3) "Start session with N players". Selected
   players go into the session as Expected. Offers Resume if a session is
   stored. A small link opens the Roster screen for renames and removals.
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
`restingRound`; rounds with `status`, `locked`, `courts`, `sitting`, `endsAt`).
The document carries a `schemaVersion` for future migrations.
