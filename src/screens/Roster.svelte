<script lang="ts">
  import { app, addPlayer, renamePlayer, removePlayer, playerInSession } from '../lib/store.svelte'

  let { onback }: { onback: () => void } = $props()

  let newName = $state('')
  let editingId = $state<string | null>(null)
  let editName = $state('')
  let confirmRemoveId = $state<string | null>(null)

  function add() {
    if (!newName.trim()) return
    addPlayer(newName)
    newName = ''
  }

  function beginEdit(id: string, name: string) {
    editingId = id
    editName = name
    confirmRemoveId = null
  }

  function saveEdit() {
    if (editingId) renamePlayer(editingId, editName)
    editingId = null
  }
</script>

<main class="screen">
  <div class="row" style="margin-bottom: 0.8rem">
    <button class="ghost" onclick={onback}>‹ Back</button>
    <h1 class="grow" style="margin: 0">Roster</h1>
  </div>

  <form
    class="row"
    onsubmit={(e) => {
      e.preventDefault()
      add()
    }}
  >
    <input type="text" class="grow" placeholder="New player name" bind:value={newName} autocomplete="off" enterkeyhint="done" />
    <button class="primary" type="submit" disabled={!newName.trim()}>Add</button>
  </form>

  <p class="muted" style="margin-top: 0.8rem">{app.roster.length} players. Players in the current session cannot be removed.</p>

  <div class="stack">
    {#each app.roster as p (p.id)}
      <div class="card" style="margin: 0">
        {#if editingId === p.id}
          <form
            class="row"
            onsubmit={(e) => {
              e.preventDefault()
              saveEdit()
            }}
          >
            <input type="text" class="grow" bind:value={editName} />
            <button class="primary" type="submit">Save</button>
            <button type="button" onclick={() => (editingId = null)}>Cancel</button>
          </form>
        {:else}
          <div class="row">
            <span class="grow">{p.name}</span>
            <button class="small" onclick={() => beginEdit(p.id, p.name)}>Rename</button>
            {#if confirmRemoveId === p.id}
              <button class="small danger" onclick={() => removePlayer(p.id)}>Confirm</button>
              <button class="small" onclick={() => (confirmRemoveId = null)}>Keep</button>
            {:else}
              <button class="small" disabled={playerInSession(p.id)} onclick={() => (confirmRemoveId = p.id)}>Remove</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted">No players yet. Add the club's regulars here, or add them as they arrive on the check-in screen.</p>
    {/each}
  </div>
</main>
