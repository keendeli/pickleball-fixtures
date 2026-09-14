<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { app, addPlayer, startSession, hasSessionForToday } from '../lib/store.svelte'
  import { VENUES, venueById } from '../lib/venues'
  import { primeAudio } from '../lib/device'

  let { onstarted, onroster }: { onstarted: () => void; onroster: () => void } = $props()

  let venueId = $state(app.session?.venueId ?? VENUES[0].id)
  let roundCount = $state(12)
  let roundMinutes = $state(10)
  let confirmReplace = $state(false)

  // Step 2: who is expected today. Component state only; becomes the
  // session's attendees (arrived = false) on start.
  let newName = $state('')
  const selected = new SvelteSet<string>()

  const existing = $derived(app.session)
  const existingIsToday = $derived(hasSessionForToday())
  const roster = $derived(app.roster.slice().sort((a, b) => a.name.localeCompare(b.name)))
  const selectedCount = $derived(roster.filter((p) => selected.has(p.id)).length)
  const canStart = $derived(roundCount >= 1 && roundMinutes >= 1)

  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
  }

  function selectAll() {
    for (const p of roster) selected.add(p.id)
  }

  function clearAll() {
    selected.clear()
  }

  function addName(e: Event) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const p = addPlayer(name) // de-duplicates by name, returns the existing player
    selected.add(p.id)
    newName = ''
  }

  function start() {
    if (existing && !confirmReplace) {
      confirmReplace = true
      return
    }
    primeAudio()
    const ids = roster.filter((p) => selected.has(p.id)).map((p) => p.id)
    startSession(venueId, roundCount, roundMinutes, ids)
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
      <h2 id="step2">Who's coming today</h2>
    </div>

    <form class="row" onsubmit={addName}>
      <input
        type="text"
        class="grow"
        placeholder="Add a name"
        bind:value={newName}
        autocomplete="off"
        autocapitalize="words"
        enterkeyhint="done"
        aria-label="Add a name"
        onkeydown={(e) => {
          if (e.key === 'Enter') addName(e)
        }}
      />
      <button class="primary" type="submit" disabled={!newName.trim()}>Add</button>
    </form>

    {#if roster.length === 0}
      <p class="muted" style="margin-top: 0.8rem">No players yet. Add the names of everyone who said they're coming.</p>
    {:else}
      <div class="row" style="margin-top: 0.8rem">
        <span class="grow muted">{selectedCount} selected of {roster.length}</span>
        <button class="small" onclick={selectAll} disabled={selectedCount === roster.length}>Select all</button>
        <button class="small" onclick={clearAll} disabled={selectedCount === 0}>Clear</button>
      </div>
      <div class="stack" style="margin-top: 0.6rem">
        {#each roster as p (p.id)}
          <div class="card row" style="margin: 0">
            <span class="grow">{p.name}</span>
            <button class="toggle" class:on={selected.has(p.id)} onclick={() => toggle(p.id)} aria-pressed={selected.has(p.id)}>
              {selected.has(p.id) ? '✓ Coming' : 'Coming?'}
            </button>
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
    {#if selectedCount === 0}
      <p class="muted">Nobody selected yet. That's fine: people can be added as they arrive at check-in.</p>
    {:else}
      <p class="muted">Selected players go to the Expected list at check-in; tap Arrived as they turn up.</p>
    {/if}
    {#if confirmReplace}
      <p class="pill warn">This replaces the unfinished session. The roster is kept.</p>
    {/if}
    <button class="primary big" onclick={start} disabled={!canStart}>
      {#if confirmReplace}
        Yes, start new session
      {:else if selectedCount > 0}
        Start session with {selectedCount} {selectedCount === 1 ? 'player' : 'players'}
      {:else}
        Start session
      {/if}
    </button>
  </section>
</main>
