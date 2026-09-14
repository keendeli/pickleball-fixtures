<script lang="ts">
  import { app, addPlayer, addAttendee, removeAttendee, setArrived, unmarkLeft, playerName, roundSummary } from '../lib/store.svelte'
  import { primeAudio } from '../lib/device'

  let { onrounds, onroster }: { onrounds: () => void; onroster: () => void } = $props()

  let query = $state('')

  const session = $derived(app.session!)
  const attendeeIds = $derived(new Set(session.attendees.map((a) => a.playerId)))
  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const pool = app.roster.filter((p) => !attendeeIds.has(p.id))
    if (!q) return pool.slice(0, 8)
    return pool.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  })
  const exactMatch = $derived(
    app.roster.some((p) => p.name.trim().toLowerCase() === query.trim().toLowerCase()),
  )
  const arrived = $derived(session.attendees.filter((a) => a.arrived && a.leftAfterRound === undefined))
  const expected = $derived(session.attendees.filter((a) => !a.arrived))
  const gone = $derived(session.attendees.filter((a) => a.arrived && a.leftAfterRound !== undefined))
  const summary = $derived(roundSummary(session.currentRound))
  const roundStatus = $derived(session.rounds[session.currentRound]?.status ?? 'pending')

  function pick(playerId: string) {
    primeAudio()
    addAttendee(playerId, true)
    query = ''
  }

  function addNew() {
    const name = query.trim()
    if (!name) return
    primeAudio()
    const p = addPlayer(name)
    addAttendee(p.id, true)
    query = ''
  }

  function submit(e: Event) {
    e.preventDefault()
    if (exactMatch) {
      const match = suggestions.find((p) => p.name.trim().toLowerCase() === query.trim().toLowerCase())
      if (match) pick(match.id)
    } else {
      addNew()
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') submit(e)
  }

  function sortedByName<T extends { playerId: string }>(list: T[]): T[] {
    return list.slice().sort((a, b) => playerName(a.playerId).localeCompare(playerName(b.playerId)))
  }
</script>

<main class="screen">
  <h1>Check-in</h1>

  <form onsubmit={submit} class="stack">
    <input
      type="search"
      placeholder="Add player by name…"
      bind:value={query}
      autocomplete="off"
      autocapitalize="words"
      enterkeyhint="done"
      aria-label="Add player"
      onkeydown={onKey}
    />
    {#if query.trim() || suggestions.length > 0}
      <div class="suggest">
        {#each suggestions as p (p.id)}
          <button type="button" onclick={() => pick(p.id)}>{p.name}<span class="muted"> · arrived</span></button>
        {/each}
        {#if query.trim() && !exactMatch}
          <button type="button" class="primary" onclick={addNew}>Add “{query.trim()}” as a new player</button>
        {/if}
      </div>
    {/if}
  </form>

  <section class="card counts">
    <div><strong>{arrived.length}</strong><span class="muted">arrived</span></div>
    <div><strong>{summary.onCourt}</strong><span class="muted">on court</span></div>
    <div><strong>{summary.sitting}</strong><span class="muted">sitting</span></div>
    <div><strong>{summary.courts}</strong><span class="muted">{summary.courts === 1 ? 'court' : 'courts'}</span></div>
  </section>
  <p class="muted" style="margin-top: -0.4rem">
    Round {session.currentRound + 1} of {session.roundCount}{roundStatus === 'pending' ? ' (not started)' : roundStatus === 'active' ? ' (in play)' : ' (done)'}.
    Rounds regenerate as attendance changes.
  </p>

  <button class="primary big" onclick={onrounds} disabled={summary.courts === 0}>
    {summary.courts === 0 ? 'Need at least 4 arrived' : 'Rounds ›'}
  </button>

  {#if expected.length > 0}
    <h2 style="margin-top: 1.2rem">Expected ({expected.length})</h2>
    <div class="stack">
      {#each sortedByName(expected) as a (a.playerId)}
        <div class="card row" style="margin: 0">
          <span class="grow">{playerName(a.playerId)}</span>
          <button class="small" onclick={() => removeAttendee(a.playerId)} aria-label="Remove {playerName(a.playerId)}">✕</button>
          <button class="primary toggle" onclick={() => setArrived(a.playerId, true)} aria-pressed="false">Arrived</button>
        </div>
      {/each}
    </div>
  {/if}

  <h2 style="margin-top: 1.2rem">Arrived ({arrived.length})</h2>
  <div class="stack">
    {#each sortedByName(arrived) as a (a.playerId)}
      <div class="card row" style="margin: 0">
        <span class="grow">
          {playerName(a.playerId)}
          {#if a.restingRound !== undefined}<span class="pill warn">resting R{a.restingRound + 1}</span>{/if}
        </span>
        <button class="toggle on" onclick={() => setArrived(a.playerId, false)} aria-pressed="true">✓ Arrived</button>
      </div>
    {:else}
      <p class="muted">Nobody yet. Tap a name above as people arrive.</p>
    {/each}
  </div>

  {#if gone.length > 0}
    <h2 style="margin-top: 1.2rem">Left ({gone.length})</h2>
    <div class="stack">
      {#each sortedByName(gone) as a (a.playerId)}
        <div class="card row" style="margin: 0">
          <span class="grow muted">
            {playerName(a.playerId)}
            <span class="pill">{(a.leftAfterRound ?? -1) < 0 ? 'before R1' : `after R${(a.leftAfterRound ?? 0) + 1}`}</span>
          </span>
          <button class="small" onclick={() => unmarkLeft(a.playerId)}>Back in</button>
        </div>
      {/each}
    </div>
  {/if}

  <p style="margin-top: 1.5rem"><button class="ghost" onclick={onroster}>Manage roster</button></p>
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
  .counts {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    text-align: center;
    margin-top: 1rem;
  }
  .counts strong {
    display: block;
    font-size: 1.6rem;
  }
  .counts span {
    font-size: 0.85rem;
  }
</style>
