<script>
  import { api } from './api'

  let { guildId } = $props()

  let entries = $state([])
  let weekly = $state(false)
  let loading = $state(false)
  let error = $state('')

  async function load() {
    loading = true
    error = ''
    try {
      const data = await api.leaderboard(guildId, { weekly })
      entries = data.entries ?? []
    } catch (err) {
      error = err.message
      entries = []
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (guildId) load()
  })
</script>

<section>
  <div class="toolbar">
    <h2>{weekly ? 'Weekly leaderboard' : 'All-time leaderboard'}</h2>
    <button onclick={() => (weekly = !weekly)}>
      Show {weekly ? 'all-time' : 'weekly'}
    </button>
    <button onclick={load}>Refresh</button>
  </div>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <table>
      <thead>
        <tr><th>#</th><th>User</th><th>Level</th><th>XP</th><th>Weekly</th></tr>
      </thead>
      <tbody>
        {#each entries as e (e.position)}
          <tr>
            <td>{e.position}</td>
            <td><code>{e.userId}</code></td>
            <td>{e.level}</td>
            <td>{e.xp.toLocaleString()}</td>
            <td>{e.weeklyXp.toLocaleString()}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="hint">No XP recorded yet.</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
