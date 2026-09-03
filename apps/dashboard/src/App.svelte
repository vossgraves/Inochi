<script>
  import { onMount } from 'svelte'
  import Health from './lib/Health.svelte'
  import Leaderboard from './lib/Leaderboard.svelte'
  import Settings from './lib/Settings.svelte'
  import Audit from './lib/Audit.svelte'
  import ApiKeys from './lib/ApiKeys.svelte'
  import { api, loginUrl } from './lib/api.js'

  let view = $state('leaderboard')
  let guildId = $state('')
  let session = $state(null)
  let sessionChecked = $state(false)
  const views = [
    ['leaderboard', 'Leaderboard'],
    ['settings', 'Settings'],
    ['rewards', 'API & Rewards'],
    ['audit', 'Audit'],
    ['health', 'Health'],
  ]

  onMount(async () => {
    try {
      session = await api.me()
      if (session.guilds?.length === 1) guildId = session.guilds[0].id
    } catch {
      session = null
    } finally {
      sessionChecked = true
    }
  })
</script>

<header>
  <h1>Inochi</h1>
  <nav>
    {#each views as [id, label]}
      <button class:active={view === id} onclick={() => (view = id)}>
        {label}
      </button>
    {/each}
  </nav>
  <div class="session">
    {#if sessionChecked && session}
      <span class="hint">{session.user.username}</span>
      <a class="logout" href={`${loginUrl().replace('/auth/login', '')}/auth/logout`}>Log out</a>
    {:else if sessionChecked}
      <a class="login" href={loginUrl()}>Log in with Discord</a>
    {/if}
  </div>
</header>

<main>
  <label class="guild">
    {session?.guilds?.length ? 'Server' : 'Guild ID'}
    {#if session?.guilds?.length}
      <select bind:value={guildId}>
        <option value="" disabled selected>Choose a server…</option>
        {#each session.guilds as g}
          <option value={g.id}>{g.name}</option>
        {/each}
      </select>
    {:else}
      <input
        placeholder="e.g. 123456789012345678"
        bind:value={guildId}
      />
    {/if}
  </label>

  {#if view === 'health'}
    <Health />
  {:else if view === 'rewards'}
    <ApiKeys {guildId} />
  {:else if !guildId.trim()}
    <p class="hint">
      {sessionChecked && !session
        ? 'Log in with Discord to pick a server, or enter a guild ID with an admin token.'
        : 'Choose a server to load its data.'}
    </p>
  {:else if view === 'leaderboard'}
    <Leaderboard {guildId} />
  {:else if view === 'settings'}
    <Settings {guildId} />
  {:else if view === 'audit'}
    <Audit {guildId} />
  {/if}
</main>
