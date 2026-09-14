<script lang="ts">
  import {
    app,
    playerName,
    roundSummary,
    startRound,
    pauseRound,
    resumeRound,
    nextRound,
    finishRound,
    remainingMs,
    markLeft,
    setResting,
    restTargetRound,
    swapInRound,
    toggleLock,
    reshuffle,
  } from '../lib/store.svelte'
  import { activePlayersForRound } from '../lib/scheduler'
  import { clock, useClock } from '../lib/clock.svelte'
  import { beep, vibrate, primeAudio } from '../lib/device'
  import { mmss } from '../lib/format'
  import CourtCards from '../components/CourtCards.svelte'

  let { ondisplay }: { ondisplay: () => void } = $props()

  const session = $derived(app.session!)
  let view = $state(app.session!.currentRound)
  let sheetFor = $state<string | null>(null)
  let swapFrom = $state<string | null>(null)
  let alerted = $state(new Set<number>())

  $effect(() => useClock())

  // Follow the current round whenever it advances.
  $effect(() => {
    view = session.currentRound
  })

  const round = $derived(session.rounds[view])
  const isCurrent = $derived(view === session.currentRound)
  const summary = $derived(roundSummary(view))
  const activeCount = $derived(activePlayersForRound(session.attendees, view).length)
  const remaining = $derived(round ? remainingMs(round, clock.now) : 0)
  const paused = $derived(round?.status === 'active' && round.pausedRemainingMs !== undefined)
  const timeUp = $derived(round?.status === 'active' && !paused && remaining <= 0)
  const hasNext = $derived(view + 1 < session.roundCount)
  const restTarget = $derived(restTargetRound())

  $effect(() => {
    if (timeUp && round && !alerted.has(round.index)) {
      alerted.add(round.index)
      alerted = new Set(alerted)
      beep()
      vibrate()
    }
  })

  function onStart() {
    primeAudio()
    startRound(view)
  }

  function onNext() {
    primeAudio()
    nextRound()
  }

  function onPlayer(id: string) {
    if (!round || round.status === 'done') return
    if (swapFrom) {
      if (swapFrom !== id) {
        swapInRound(round.index, swapFrom, id)
        if (round.status === 'pending' && !round.locked) toggleLock(round.index)
      }
      swapFrom = null
      return
    }
    sheetFor = id
  }

  function beginSwap() {
    swapFrom = sheetFor
    sheetFor = null
  }

  function rest() {
    if (sheetFor && restTarget !== undefined) setResting(sheetFor, restTarget)
    sheetFor = null
  }

  function left() {
    if (sheetFor) markLeft(sheetFor)
    sheetFor = null
  }

  const sheetAttendee = $derived(sheetFor ? session.attendees.find((a) => a.playerId === sheetFor) : undefined)
</script>

<main class="screen">
  {#if !round}
    <p>No rounds yet.</p>
  {:else}
    <div class="row" style="margin-bottom: 0.6rem">
      <button class="small" disabled={view === 0} onclick={() => (view -= 1)} aria-label="Previous round">‹</button>
      <h1 class="grow" style="margin: 0; text-align: center">Round {view + 1} of {session.roundCount}</h1>
      <button class="small" disabled={!hasNext} onclick={() => (view += 1)} aria-label="Next round">›</button>
    </div>

    <div class="row wrap" style="justify-content: center; margin-bottom: 0.8rem">
      {#if round.status === 'done'}
        <span class="pill">Done</span>
      {:else if round.status === 'active'}
        <span class="pill">{paused ? 'Paused' : 'In play'}</span>
      {:else}
        <span class="pill warn">Not started</span>
      {/if}
      {#if round.locked}<span class="pill">Locked</span>{/if}
      <span class="muted">{summary.courts} {summary.courts === 1 ? 'court' : 'courts'} · {summary.onCourt} playing · {summary.sitting} sitting</span>
      {#if !isCurrent}
        <button class="small ghost" onclick={() => (view = session.currentRound)}>Go to current</button>
      {/if}
    </div>

    {#if isCurrent}
      <section class="card timer" class:timeup={timeUp}>
        <div class="clock" aria-live="polite">
          {#if round.status === 'pending'}
            {mmss(session.roundMinutes * 60_000)}
          {:else if round.status === 'done'}
            Done
          {:else}
            {timeUp ? "Time's up" : mmss(remaining)}
          {/if}
        </div>
        <div class="row">
          {#if round.status === 'pending'}
            <button class="primary big" onclick={onStart} disabled={summary.courts === 0}>Start round {view + 1}</button>
          {:else if round.status === 'active'}
            {#if paused}
              <button class="grow big" onclick={() => resumeRound(view)}>Resume</button>
            {:else}
              <button class="grow big" onclick={() => pauseRound(view)}>Pause</button>
            {/if}
            {#if hasNext}
              <button class="primary grow big" onclick={onNext}>Next round ›</button>
            {:else}
              <button class="primary grow big" onclick={() => finishRound(view)}>Finish</button>
            {/if}
          {:else if hasNext}
            <button class="primary big" onclick={onNext}>Start round {view + 2} ›</button>
          {:else}
            <p class="muted" style="margin: 0">Session complete. Use End in the header when you are done.</p>
          {/if}
        </div>
      </section>
    {/if}

    {#if swapFrom}
      <div class="card banner">
        Swapping <strong>{playerName(swapFrom)}</strong> — tap the player to swap with.
        <button class="small" onclick={() => (swapFrom = null)}>Cancel</button>
      </div>
    {/if}

    {#if round.substituted.length > 0}
      <p class="subnote" aria-live="polite">
        Substituted in: {round.substituted.map(playerName).join(', ')}
      </p>
    {/if}

    <CourtCards {round} {activeCount} onplayer={round.status === 'done' ? undefined : onPlayer} selected={swapFrom} />

    <div class="row wrap" style="margin-top: 0.4rem">
      {#if round.status === 'pending'}
        <button class="small" onclick={() => toggleLock(view)}>{round.locked ? 'Unlock round' : 'Lock round'}</button>
        <button class="small" onclick={reshuffle}>Reshuffle remaining</button>
      {/if}
      <span class="grow"></span>
      <button class="small" onclick={ondisplay}>Display mode</button>
    </div>
    {#if round.status === 'pending'}
      <p class="muted" style="margin-top: 0.6rem; font-size: 0.9rem">
        Tap a name to swap, rest or mark as left. A swap locks the round so regeneration keeps it.
      </p>
    {:else if round.status === 'active'}
      <p class="muted" style="margin-top: 0.6rem; font-size: 0.9rem">
        Tap a name to swap or mark as left. Someone who leaves mid-round is replaced from the sitters and the replacement is highlighted.
      </p>
    {/if}
  {/if}
</main>

{#if sheetFor}
  <div class="scrim" role="presentation" onclick={() => (sheetFor = null)}></div>
  <div class="sheet" role="dialog" aria-label="Player actions">
    <h2>{playerName(sheetFor)}</h2>
    <div class="stack">
      <button onclick={beginSwap}>Swap with…</button>
      {#if restTarget !== undefined}
        {#if sheetAttendee?.restingRound === restTarget}
          <button onclick={() => { setResting(sheetFor!, undefined); sheetFor = null }}>Cancel rest for round {restTarget + 1}</button>
        {:else}
          <button onclick={rest}>Rest {restTarget === session.currentRound ? 'this' : 'next'} round ({restTarget + 1})</button>
        {/if}
      {/if}
      <button class="danger" onclick={left}>Left the session</button>
      <button class="ghost" onclick={() => (sheetFor = null)}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .timer {
    text-align: center;
  }
  .clock {
    font-size: 3.4rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin-bottom: 0.6rem;
  }
  .timeup {
    background: var(--warn-soft);
    border-color: var(--warn);
  }
  .subnote {
    margin: 0 0 0.6rem;
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius);
    background: var(--sub-soft);
    border: 1px solid var(--sub);
    font-weight: 600;
  }
  .banner {
    background: var(--accent-soft);
    border-color: var(--accent);
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    background: var(--card);
    border-radius: var(--radius) var(--radius) 0 0;
    padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
    max-width: 760px;
    margin: 0 auto;
  }
</style>
