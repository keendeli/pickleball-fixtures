<script lang="ts">
  import { app, remainingMs, roundSummary, startRound, nextRound, finishRound } from '../lib/store.svelte'
  import { activePlayersForRound } from '../lib/scheduler'
  import { clock, useClock } from '../lib/clock.svelte'
  import { beep, vibrate, primeAudio, requestWakeLock, releaseWakeLock } from '../lib/device'
  import { mmss } from '../lib/format'
  import { venueById } from '../lib/venues'
  import CourtCards from '../components/CourtCards.svelte'

  let { onexit }: { onexit: () => void } = $props()

  const session = $derived(app.session!)
  const round = $derived(session.rounds[session.currentRound])
  const activeCount = $derived(activePlayersForRound(session.attendees, session.currentRound).length)
  const summary = $derived(roundSummary(session.currentRound))
  const remaining = $derived(round ? remainingMs(round, clock.now) : 0)
  const paused = $derived(round?.status === 'active' && round.pausedRemainingMs !== undefined)
  const timeUp = $derived(round?.status === 'active' && !paused && remaining <= 0)
  const hasNext = $derived(session.currentRound + 1 < session.roundCount)
  let wakeLocked = $state(false)
  let alerted = $state(new Set<number>())

  $effect(() => useClock())

  $effect(() => {
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState === 'visible') {
        const ok = await requestWakeLock()
        if (!cancelled) wakeLocked = ok
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void releaseWakeLock()
    }
  })

  $effect(() => {
    if (timeUp && round && !alerted.has(round.index)) {
      alerted.add(round.index)
      alerted = new Set(alerted)
      beep()
      vibrate()
    }
  })

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onexit()
  }

  function act(fn: () => void) {
    return (e: MouseEvent) => {
      e.stopPropagation()
      primeAudio()
      fn()
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="display" role="button" tabindex="0" onclick={onexit} onkeydown={onKey}>
  {#if round}
    <header>
      <div class="round">Round {round.index + 1} <span class="of">of {session.roundCount}</span></div>
      <div class="venue">{venueById(session.venueId).name} · {summary.courts} {summary.courts === 1 ? 'court' : 'courts'}</div>
    </header>

    <div class="clock" class:timeup={timeUp} class:paused>
      {#if round.status === 'pending'}
        {mmss(session.roundMinutes * 60_000)}
      {:else if round.status === 'done'}
        Done
      {:else if timeUp}
        Time's up
      {:else}
        {mmss(remaining)}
      {/if}
      {#if paused}<span class="sub">paused</span>{/if}
    </div>

    <CourtCards {round} {activeCount} large />

    <div class="controls">
      {#if round.status === 'pending'}
        <button class="primary big" onclick={act(() => startRound(round.index))} disabled={summary.courts === 0}>Start round {round.index + 1}</button>
      {:else if round.status === 'active' && hasNext}
        <button class="primary big" onclick={act(nextRound)}>Next round ›</button>
      {:else if round.status === 'active'}
        <button class="primary big" onclick={act(() => finishRound(round.index))}>Finish</button>
      {:else if hasNext}
        <button class="primary big" onclick={act(nextRound)}>Start round {round.index + 2} ›</button>
      {/if}
    </div>
  {/if}
  <footer class="muted">Tap anywhere to exit{wakeLocked ? ' · screen stays awake' : ''}</footer>
</div>

<style>
  .display {
    min-height: 100vh;
    padding: 1.2rem 1.5rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    cursor: pointer;
    max-width: 1100px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .round {
    font-size: 2.4rem;
    font-weight: 800;
  }
  .of {
    font-size: 1.4rem;
    color: var(--muted);
    font-weight: 500;
  }
  .venue {
    font-size: 1.2rem;
    color: var(--muted);
  }
  .clock {
    font-size: clamp(4rem, 18vw, 9rem);
    font-weight: 800;
    text-align: center;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    padding: 0.5rem 0;
  }
  .clock.timeup {
    color: var(--warn);
    font-size: clamp(3rem, 12vw, 6rem);
  }
  .clock.paused {
    color: var(--muted);
  }
  .sub {
    display: block;
    font-size: 1.4rem;
    font-weight: 500;
  }
  .controls {
    cursor: default;
    margin-top: auto;
  }
  footer {
    text-align: center;
    font-size: 1rem;
  }
</style>
