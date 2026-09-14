<script lang="ts">
  import { app, endSession, regenerate } from './lib/store.svelte'
  import { venueById } from './lib/venues'
  import Start from './screens/Start.svelte'
  import Roster from './screens/Roster.svelte'
  import CheckIn from './screens/CheckIn.svelte'
  import Rounds from './screens/Rounds.svelte'
  import Display from './screens/Display.svelte'

  type Screen = 'start' | 'roster' | 'checkin' | 'rounds' | 'display'

  let screen = $state<Screen>(app.session ? 'checkin' : 'start')
  let confirmEnd = $state(false)

  const venueName = $derived(app.session ? venueById(app.session.venueId).name : '')

  function go(s: Screen) {
    screen = s
    window.scrollTo(0, 0)
  }

  function onSessionStarted() {
    go('checkin')
  }

  function doEndSession() {
    endSession()
    confirmEnd = false
    go('start')
  }

  // If another tab/window started or ended the session, keep the screen sane.
  $effect(() => {
    if (!app.session && screen !== 'start' && screen !== 'roster') screen = 'start'
  })

  // Re-run the engine once on load in case a build changed the rules while a session was stored.
  if (app.session) regenerate()
</script>

{#if screen === 'display' && app.session}
  <Display onexit={() => go('rounds')} />
{:else}
  {#if app.session && screen !== 'start' && screen !== 'roster'}
    <header class="topbar">
      <span class="title">{venueName}</span>
      {#if confirmEnd}
        <button onclick={doEndSession} style="background: var(--danger); border-color: var(--danger); color: #fff">End session</button>
        <button onclick={() => (confirmEnd = false)}>Keep</button>
      {:else}
        <button onclick={() => (confirmEnd = true)}>End</button>
      {/if}
    </header>
  {/if}

  {#if screen === 'start'}
    <Start onstarted={onSessionStarted} onroster={() => go('roster')} />
  {:else if screen === 'roster'}
    <Roster onback={() => go(app.session ? 'checkin' : 'start')} />
  {:else if screen === 'checkin' && app.session}
    <CheckIn onrounds={() => go('rounds')} onroster={() => go('roster')} />
  {:else if screen === 'rounds' && app.session}
    <Rounds ondisplay={() => go('display')} />
  {/if}

  {#if app.session && screen !== 'start' && screen !== 'roster'}
    <nav class="tabs" aria-label="Session">
      <button class:active={screen === 'checkin'} onclick={() => go('checkin')}>Check-in</button>
      <button class:active={screen === 'rounds'} onclick={() => go('rounds')}>Rounds</button>
      <button onclick={() => go('display')}>Display</button>
    </nav>
  {/if}
{/if}
