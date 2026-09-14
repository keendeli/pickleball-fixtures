<script lang="ts">
  import { install, isIOS, promptInstall } from '../lib/install.svelte'

  // Unobtrusive "Add to home screen" control. Rendered only in a browser tab:
  // hidden when installed, and shown nothing at all where we have no way to
  // install (Firefox, desktop Safari) so it never nags.
  let dismissed = $state(false)
  let showIOSHelp = $state(false)

  const ios = isIOS()
  const canPrompt = $derived(install.prompt !== null)
  const visible = $derived(!install.installed && !dismissed && (canPrompt || ios))

  async function onclick() {
    if (canPrompt) {
      const accepted = await promptInstall()
      if (accepted) dismissed = true
    } else if (ios) {
      showIOSHelp = !showIOSHelp
    }
  }
</script>

{#if visible}
  <div class="install">
    <button class="ghost link" onclick={onclick} aria-expanded={ios && !canPrompt ? showIOSHelp : undefined}>
      Add to home screen
    </button>
    {#if showIOSHelp}
      <p class="help muted">
        In Safari tap the Share button, then ‘Add to Home Screen’.
        <button class="ghost close" onclick={() => (showIOSHelp = false)}>Close</button>
      </p>
    {/if}
  </div>
{/if}

<style>
  .install {
    margin-top: 1.5rem;
    text-align: center;
  }
  .link {
    color: var(--muted);
    font-weight: 500;
    font-size: 0.95rem;
    min-height: 40px;
    padding: 0.3rem 0.8rem;
  }
  .help {
    margin: 0.4rem auto 0;
    max-width: 24rem;
    font-size: 0.9rem;
  }
  .close {
    min-height: 32px;
    padding: 0.1rem 0.5rem;
    font-size: 0.9rem;
    color: var(--accent);
  }
</style>
