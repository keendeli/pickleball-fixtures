<script lang="ts">
  import {
    app,
    addPlayer,
    addToday,
    removeToday,
    setTodayArrived,
    clearToday,
    startSession,
    hasSessionForToday,
    playerName,
  } from '../lib/store.svelte'
  import { VENUES, venueById } from '../lib/venues'
  import { primeAudio } from '../lib/device'

  let { onstarted, onroster }: { onstarted: () => void; onroster: () => void } = $props()

  let venueId = $state(app.session?.venueId ?? VENUES[0].id)
  let roundCount = $state(12)
  let roundMinutes = $state(10)
  let confirmReplace = $state(false)
  let confirmClear = $state(false)

  // Step 2: today's list. Lives in app.today (persisted) so the convenor can
  // build it the night before from TeamReach and open the app at the venue.
  let query = $state('')

  const existing = $derived(app.session)
  const existingIsToday = $derived(hasSessionForToday())
  const todayIds = $derived(new Set(app.today.map((t) => t.playerId)))
  const today = $derived(
    app.today.slice().sort((a, b) => playerName(a.playerId).localeCompare(playerName(b.playerId))),
  )
  const arrivedCount = $derived(app.today.filter((t) => t.arrived).length)
  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return app.roster.filter((p) => !todayIds.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8)
  })
  const exactMatch = $derived(
    app.roster.some((p) => p.name.trim().toLowerCase() === query.trim().toLowerCase()),
  )
  const canStart = $derived(roundCount >= 1 && roundMinutes >= 1)

  function pick(playerId: string) {
    addToday(playerId)
    query = ''
  }

  function addNew() {
    const name = query.trim()
    if (!name) return
    const p = addPlayer(name) // de-duplicates by name, returns the existing player
    addToday(p.id)
    query = ''
  }

  function submit(e: Event) {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    if (!q) return
    const match = app.roster.find((p) => p.name.trim().toLowerCase() === q)
    if (match) pick(match.id)
    else addNew()
  }

  function clear() {
    clearToday()
    confirmClear = false
  }

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
    <h2 style="margin-top: 1.2rem">Or start a new session</h2>
  {/if}

  <section class="card" aria-labelledby="step1">
    <div class="step-head">
      <span class="step-num" aria-hidden="true">1</span>
      <h2 id="step1">Venue and format</h2>
    </div>
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
  </section>

  <section class="card" aria-labelledby="step2">
    <div class="step-head">
      <span class="step-num" aria-hidden="true">2</span>
      <h2 id="step2">Today's players</h2>
    </div>

    <form class="stack" onsubmit={submit}>
      <div class="row">
        <input
          type="text"
          class="grow"
          placeholder="Add a name"
          bind:value={query}
          autocomplete="off"
          autocapitalize="words"
          enterkeyhint="done"
          aria-label="Add a name"
          onkeydown={(e) => {
            if (e.key === 'Enter') submit(e)
          }}
        />
        <button class="primary" type="submit" disabled={!query.trim()}>Add</button>
      </div>
      {#if query.trim()}
        <div class="suggest" role="listbox" aria-label="Matching players">
          {#each suggestions as p (p.id)}
            <button type="button" role="option" aria-selected="false" onclick={() => pick(p.id)}>{p.name}</button>
          {/each}
          {#if !exactMatch}
            <button type="button" role="option" aria-selected="false" class="primary" onclick={addNew}>Add “{query.trim()}” as a new player</button>
          {/if}
        </div>
      {/if}
    </form>

    {#if today.length === 0}
      <p class="muted" style="margin-top: 0.8rem">Nobody on the list yet. Add the names of everyone who said they're coming, then tap Arrived as they turn up.</p>
    {:else}
      <div class="row wrap" style="margin-top: 0.8rem">
        <span class="grow muted">{today.length} on the list · {arrivedCount} arrived</span>
        {#if confirmClear}
          <button class="small danger" onclick={clear}>Clear {today.length} {today.length === 1 ? 'player' : 'players'}?</button>
          <button class="small" onclick={() => (confirmClear = false)}>Keep</button>
        {:else}
          <button class="small" onclick={() => (confirmClear = true)}>Clear list</button>
        {/if}
      </div>
      <div class="stack" style="margin-top: 0.6rem">
        {#each today as t (t.playerId)}
          <div class="card row" style="margin: 0">
            <span class="grow">{playerName(t.playerId)}</span>
            <button class="small" onclick={() => removeToday(t.playerId)} aria-label="Remove {playerName(t.playerId)} from today's list">✕</button>
            {#if t.arrived}
              <button class="toggle on" onclick={() => setTodayArrived(t.playerId, false)} aria-pressed="true">✓ Arrived</button>
            {:else}
              <button class="primary toggle" onclick={() => setTodayArrived(t.playerId, true)} aria-pressed="false">Arrived</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <p style="margin: 0.8rem 0 0"><button class="ghost" onclick={onroster}>Rename or remove players</button></p>
  </section>

  <section class="card" aria-labelledby="step3">
    <div class="step-head">
      <span class="step-num" aria-hidden="true">3</span>
      <h2 id="step3">Start</h2>
    </div>
    {#if arrivedCount === 0}
      <p class="muted">Nobody has arrived yet. That's fine: the list goes to Check-in and you tick people off there.</p>
    {:else}
      <p class="muted">Round 1 is built from the {arrivedCount} arrived. Anyone still to come is listed as Expected at Check-in.</p>
    {/if}
    {#if confirmReplace}
      <p class="pill warn">This replaces the unfinished session. The roster is kept.</p>
    {/if}
    <button class="primary big" onclick={start} disabled={!canStart}>
      {#if confirmReplace}
        Yes, start new session
      {:else if arrivedCount > 0}
        Start session with {arrivedCount} arrived
      {:else}
        Start session
      {/if}
    </button>
  </section>
</main>

<style>
  .suggest {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .suggest button {
    text-align: left;
  }
</style>
