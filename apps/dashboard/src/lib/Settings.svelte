<script>
  import { api } from './api'

  let { guildId } = $props()

  const blank = {
    xp_per_message: 15,
    gain: { min: 15, max: 25 },
    cooldown_seconds: 60,
    xp_paused: false,
    curve: { constant: 0, cubic: 1.6666666666666667, quadratic: 22.5, linear: 75.83333333333333, rounding: 1, max_level: null },
    announce_channel_id: null,
    welcome_channel_id: null,
    welcome_template: null,
    rank_background_url: null,
    multipliers: [],
    blacklist: { channels: [], roles: [] },
  }

  // Preset curve/gain constants (mirrors crates/core presets.ts).
  const presets = {
    inochi: { gain: { min: 50, max: 100 }, cooldown_seconds: 60, curve: { constant: 0, cubic: 1, quadratic: 50, linear: 100, rounding: 100 } },
    lurkr: { gain: { min: 15, max: 40 }, cooldown_seconds: 60, curve: { constant: 150, cubic: 0, quadratic: 50, linear: -100, rounding: 1 } },
    mee6: { gain: { min: 15, max: 25 }, cooldown_seconds: 60, curve: { constant: 0, cubic: 1.6666666666666667, quadratic: 22.5, linear: 75.83333333333333, rounding: 1 } },
    amari: { gain: { min: 1, max: 1 }, cooldown_seconds: 8, curve: { constant: 55, cubic: 0, quadratic: 20, linear: -40, rounding: 1 } },
  }

  let preset = $state('mee6')

  function detectPreset(s = settings) {
    for (const [name, p] of Object.entries(presets)) {
      if (
        s.gain?.min === p.gain.min && s.gain?.max === p.gain.max &&
        s.cooldown_seconds === p.cooldown_seconds &&
        s.curve?.constant === p.curve.constant && s.curve?.cubic === p.curve.cubic &&
        s.curve?.quadratic === p.curve.quadratic && s.curve?.linear === p.curve.linear
      ) return name
    }
    return 'custom'
  }

  function applyPreset() {
    const p = presets[preset]
    if (!p) return
    settings.gain = { ...p.gain }
    settings.cooldown_seconds = p.cooldown_seconds
    settings.curve = { ...p.curve, max_level: settings.curve?.max_level ?? null }
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
      if (!settings.gain) settings.gain = { ...blank.gain }
      if (!settings.curve) settings.curve = { ...blank.curve }
      preset = detectPreset()
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
        Leveling preset
        <select bind:value={preset} onchange={applyPreset}>
          <option value="inochi">Inochi — 50-100 XP / 60 s</option>
          <option value="lurkr">Lurkr — 15-40 XP / 60 s</option>
          <option value="mee6">MEE6 — 15-25 XP / 60 s</option>
          <option value="amari">Amari — 1 XP / 8 s</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div class="mult">
        <label>XP min <input type="number" min="0" max="500" bind:value={settings.gain.min} oninput={() => (preset = 'custom')} /></label>
        <label>XP max <input type="number" min="0" max="500" bind:value={settings.gain.max} oninput={() => (preset = 'custom')} /></label>
        <label>Cooldown (s) <input type="number" min="0" max="3600" bind:value={settings.cooldown_seconds} oninput={() => (preset = 'custom')} /></label>
      </div>
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
        Welcome channel ID
        <input
          placeholder="optional"
          value={settings.welcome_channel_id ?? ''}
          oninput={(e) =>
            (settings.welcome_channel_id =
              e.target.value.trim() ? Number(e.target.value) : null)}
        />
      </label>
      <label>
        Welcome message ({'{user}'} {'{name}'} {'{server}'} tokens)
        <input
          placeholder="Welcome {user} to {server}!"
          value={settings.welcome_template ?? ''}
          oninput={(e) => (settings.welcome_template = e.target.value || null)}
        />
      </label>
      <label>
        Rank card background URL
        <input
          placeholder="https://… (optional)"
          value={settings.rank_background_url ?? ''}
          oninput={(e) => (settings.rank_background_url = e.target.value || null)}
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
