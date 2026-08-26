<script>
  import Health from './lib/Health.svelte'
  import Leaderboard from './lib/Leaderboard.svelte'
  import Settings from './lib/Settings.svelte'

  let view = $state('leaderboard')
  let guildId = $state('')
  const views = [
    ['leaderboard', 'Leaderboard'],
    ['settings', 'Settings'],
    ['health', 'Health'],
  ]
</script>

<header>
  <h1>inochi</h1>
  <nav>
    {#each views as [id, label]}
      <button class:active={view === id} onclick={() => (view = id)}>
        {label}
      </button>
    {/each}
  </nav>
</header>

<main>
  <label class="guild">
    Guild ID
    <input
      placeholder="e.g. 123456789012345678"
      bind:value={guildId}
    />
  </label>

  {#if !guildId.trim()}
    <p class="hint">Enter a server (guild) ID to load its data.</p>
  {:else if view === 'leaderboard'}
    <Leaderboard {guildId} />
  {:else if view === 'settings'}
    <Settings {guildId} />
  {:else}
    <Health />
  {/if}
</main>
