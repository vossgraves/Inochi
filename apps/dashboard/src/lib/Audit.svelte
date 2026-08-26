<script>
  import { api } from './api.js'

  let { guildId } = $props()

  let events = $state([])
  let error = $state('')
  let loading = $state(true)

  async function load() {
    loading = true
    error = ''
    try {
      const res = await api.audit(guildId)
      events = res.events ?? []
    } catch (e) {
      error = e.message
      events = []
    } finally {
      loading = false
    }
  }

  $effect(() => {
    guildId && load()
  })

  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }
</script>

<section>
  <div class="toolbar">
    <h2>Audit log</h2>
    <button onclick={load}>Refresh</button>
  </div>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if events.length === 0}
    <p class="hint">No configuration events recorded yet.</p>
  {:else}
    <table>
      <thead>
        <tr><th>When</th><th>Kind</th><th>Actor</th></tr>
      </thead>
      <tbody>
        {#each events as ev}
          <tr>
            <td>{fmt(ev.at)}</td>
            <td><code>{ev.kind}</code></td>
            <td>{ev.actorId ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
