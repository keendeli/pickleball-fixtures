<script lang="ts">
  import { app, startSession, hasSessionForToday } from '../lib/store.svelte'
  import { VENUES, venueById } from '../lib/venues'
  import { primeAudio } from '../lib/device'

  let { onstarted, onroster }: { onstarted: () => void; onroster: () => void } = $props()

  let venueId = $state(app.session?.venueId ?? VENUES[0].id)
  let roundCount = $state(12)
  let roundMinutes = $state(10)
  let confirmReplace = $state(false)

  const existing = $derived(app.session)
  const existingIsToday = $derived(hasSessionForToday())

  function start() {
    if (existing && !confirmReplace) {
      confirmReplace = true
      return
    }
    primeAudio()
    startSession(venueId, roundCount, roundMinutes)
    onstarted()
  }

  function resume() {
    primeAudio()
    onstarted()
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  }
</script>

<main class="screen">
  <h1>Pickleball Fixtures</h1>
  <p class="muted">Doubles fixtures for a social session. Works offline.</p>

  {#if existing}
    <section class="card">
      <h2>{existingIsToday ? "Today's session" : 'Unfinished session'}</h2>
      <p>
        {venueById(existing.venueId).name} · {fmtDate(existing.startedAt)} ·
        {existing.attendees.filter((a) => a.arrived).length} arrived · round {existing.currentRound + 1} of {existing.roundCount}
      </p>
      <button class="primary big" onclick={resume}>Resume session</button>
    </section>
  {/if}

  <section class="card">
    <h2>{existing ? 'Start a new session' : 'Venue'}</h2>
    <div class="stack">
      {#each VENUES as v (v.id)}
        <button class="big" class:primary={venueId === v.id} onclick={() => (venueId = v.id)} aria-pressed={venueId === v.id}>
          {v.name}
          <span class="muted" style={venueId === v.id ? 'color: inherit; opacity: .85' : ''}> · {v.courts} courts</span>
        </button>
      {/each}
    </div>

    <div class="row" style="margin-top: 1rem">
      <label class="grow">
        <span class="muted">Rounds</span>
        <input type="number" inputmode="numeric" min="1" max="30" bind:value={roundCount} />
      </label>
      <label class="grow">
        <span class="muted">Minutes each</span>
        <input type="number" inputmode="numeric" min="1" max="60" bind:value={roundMinutes} />
      </label>
    </div>

    {#if confirmReplace}
      <p class="pill warn" style="margin-top: 1rem">This replaces the unfinished session. The roster is kept.</p>
    {/if}
    <button class="primary big" style="margin-top: 1rem" onclick={start} disabled={!(roundCount >= 1 && roundMinutes >= 1)}>
      {confirmReplace ? 'Yes, start new session' : 'Start session'}
    </button>
  </section>

  <button class="ghost" onclick={onroster}>Roster ({app.roster.length} players)</button>
</main>
