<script lang="ts">
  import type { Round } from '../lib/types'
  import { OPEN_SLOT } from '../lib/scheduler'
  import { playerName } from '../lib/store.svelte'

  let {
    round,
    activeCount,
    large = false,
    onplayer,
    selected = null,
  }: {
    round: Round
    activeCount: number
    large?: boolean
    onplayer?: (id: string) => void
    selected?: string | null
  } = $props()

  const subs = $derived(new Set(round.substituted))
</script>

{#snippet chip(id: string)}
  {#if id === OPEN_SLOT}
    <span class="name open" aria-label="Open slot, nobody available">— open —</span>
  {:else}
    <button class="name" class:selected={selected === id} class:sub={subs.has(id)} disabled={!onplayer} onclick={() => onplayer?.(id)}>
      {playerName(id)}
      {#if subs.has(id)}<span class="in" aria-hidden="true">in</span><span class="sr-only"> (substituted in)</span>{/if}
    </button>
  {/if}
{/snippet}

{#if round.courts.length === 0}
  <div class="card notice" class:large>
    {#if activeCount === 0}
      Nobody is checked in for this round.
    {:else}
      Only {activeCount} {activeCount === 1 ? 'player' : 'players'} available — at least 4 are needed for a court. No courts in use this round.
    {/if}
  </div>
{/if}

<div class="courts" class:large>
  {#each round.courts as c (c.court)}
    <section class="card court">
      <h3>Court {c.court}</h3>
      <div class="teams">
        <div class="team">
          {#each c.teamA as id, i (i)}
            {@render chip(id)}
          {/each}
        </div>
        <div class="vs">vs</div>
        <div class="team">
          {#each c.teamB as id, i (i)}
            {@render chip(id)}
          {/each}
        </div>
      </div>
    </section>
  {/each}
</div>

{#if round.sitting.length > 0}
  <section class="card sitting" class:large>
    <h3>Sitting out</h3>
    <div class="row wrap">
      {#each round.sitting as id (id)}
        <button class="name sit" class:selected={selected === id} disabled={!onplayer} onclick={() => onplayer?.(id)}>{playerName(id)}</button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .courts {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.9rem;
    margin-bottom: 0.9rem;
  }
  @media (min-width: 640px) {
    .courts {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
  }
  .court {
    margin: 0;
  }
  .court h3 {
    color: var(--muted);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .teams {
    display: grid;
    /* minmax(0, …) so long names shrink (ellipsis) instead of widening the card. */
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 0.5rem;
    align-items: center;
  }
  .team {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }
  .vs {
    color: var(--muted);
    font-weight: 700;
  }
  .name {
    width: 100%;
    min-height: var(--tap);
    font-weight: 600;
    font-size: 1.05rem;
    background: var(--accent-soft);
    border-color: transparent;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name:disabled {
    opacity: 1;
  }
  .name.sit {
    width: auto;
    background: var(--warn-soft);
    color: var(--fg);
  }
  .name.selected {
    outline: 3px solid var(--accent);
    outline-offset: 1px;
  }
  /* Player put on court by a mid-round substitution. */
  .name.sub {
    background: var(--sub-soft);
    border: 2px solid var(--sub);
    color: var(--fg);
  }
  .in {
    display: inline-block;
    margin-left: 0.4em;
    padding: 0 0.45em;
    border-radius: 999px;
    background: var(--sub);
    color: #fff;
    font-size: 0.7em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: 0.1em;
  }
  /* Vacated slot with nobody to fill it. */
  .name.open {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--muted);
    font-weight: 500;
  }
  .sitting h3 {
    color: var(--muted);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .notice {
    color: var(--warn);
    background: var(--warn-soft);
    border-color: transparent;
    font-weight: 600;
  }

  /* Display-mode sizing */
  .large .court h3,
  .large.sitting h3,
  .large.notice {
    font-size: 1.4rem;
  }
  .large .name {
    font-size: 2rem;
    min-height: 72px;
  }
  .large .vs {
    font-size: 1.6rem;
  }
  .large.notice {
    font-size: 1.6rem;
  }
</style>
