<script>
  import { api } from './api'

  let { guildId } = $props()

  const blank = {
    xp_per_message: 15,
    cooldown_seconds: 60,
    xp_paused: false,
    announce_channel_id: null,
    multipliers: [],
    blacklist: { channels: [], roles: [] },
  }

  let settings = $state({ ...blank })
  let loading = $state(false)
  let saving = $state(false)
  let message = $state('')
  let error = $state('')

  function toCsv(list) {
    return (list ?? []).join(', ')
  }

  function fromCsv(text) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n))
  }

  async function load() {
    loading = true
    error = ''
    message = ''
    try {
      settings = { ...blank, ...(await api.getSettings(guildId)) }
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }

  async function save() {
    saving = true
    error = ''
    message = ''
    try {
      await api.saveSettings(guildId, $state.snapshot(settings))
      message = 'Saved.'
    } catch (err) {
      error = err.message
    } finally {
      saving = false
    }
  }

  $effect(() => {
    if (guildId) load()
  })
</script>

<section>
  <h2>Guild settings</h2>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); save() }}>
      <label>
        XP per message
        <input type="number" min="1" max="500" bind:value={settings.xp_per_message} />
      </label>
      <label>
        Cooldown (seconds)
        <input type="number" min="0" max="3600" bind:value={settings.cooldown_seconds} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={settings.xp_paused} />
        XP paused
      </label>
      <label>
        Announcement channel ID
        <input
          placeholder="optional"
          value={settings.announce_channel_id ?? ''}
          oninput={(e) =>
            (settings.announce_channel_id =
              e.target.value.trim() ? Number(e.target.value) : null)}
        />
      </label>
      <label>
        Blacklisted channel IDs (comma separated)
        <input value={toCsv(settings.blacklist.channels)}
          oninput={(e) => (settings.blacklist.channels = fromCsv(e.target.value))} />
      </label>
      <label>
        Blacklisted role IDs (comma separated)
        <input value={toCsv(settings.blacklist.roles)}
          oninput={(e) => (settings.blacklist.roles = fromCsv(e.target.value))} />
      </label>

      <fieldset>
        <legend>Multipliers</legend>
        {#each settings.multipliers as m, i}
          <div class="mult">
            <select bind:value={m.scope}>
              <option value="all">All</option>
              <option value="channel">Channel</option>
              <option value="role">Role</option>
            </select>
            <input placeholder="ID" disabled={m.scope === 'all'}
              value={m.id ?? ''}
              oninput={(e) => (m.id = e.target.value ? Number(e.target.value) : null)} />
            <input type="number" step="0.1" min="0" max="10" bind:value={m.factor} />
            <button type="button" class="danger"
              onclick={() => settings.multipliers.splice(i, 1)}>✕</button>
          </div>
        {:else}
          <p class="hint">No multipliers configured.</p>
        {/each}
        <button type="button"
          onclick={() =>
            settings.multipliers.push({ scope: 'all', id: null, factor: 1.5 })}>
          Add multiplier
        </button>
      </fieldset>

      <div class="actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onclick={load}>Reset</button>
        {#if message}<span class="ok">{message}</span>{/if}
        {#if error}<span class="error">{error}</span>{/if}
      </div>
    </form>
  {/if}
</section>
