<script>
  import { api } from './api'

  let { guildId } = $props()

  let keys = $state([])
  let rewards = $state([])
  let stats = $state(null)
  let loading = $state(false)
  let error = $state('')
  let newKeyLabel = $state('')
  let newKeyGuildScoped = $state(true)
  let generatedKey = $state('')

  let newRewardLevel = $state(5)
  let newRewardRoleId = $state('')
  let rewardMessage = $state('')

  async function loadAll() {
    loading = true
    error = ''
    try {
      const [kRes, rRes, sRes] = await Promise.allSettled([
        api.listKeys(),
        guildId ? api.getRewards(guildId) : Promise.resolve({ rewards: [] }),
        guildId ? api.guildStats(guildId) : Promise.resolve(null),
      ])

      if (kRes.status === 'fulfilled') keys = kRes.value?.keys || []
      if (rRes.status === 'fulfilled') rewards = rRes.value?.rewards || []
      if (sRes.status === 'fulfilled') stats = sRes.value || null
    } catch (err) {
      error = err.message || 'Failed to load data'
    } finally {
      loading = false
    }
  }

  async function createKey(e) {
    e.preventDefault()
    if (!newKeyLabel.trim()) return
    error = ''
    try {
      const res = await api.createKey(
        newKeyLabel.trim(),
        newKeyGuildScoped && guildId ? Number(guildId) : null
      )
      generatedKey = res.raw_key
      newKeyLabel = ''
      await loadAll()
    } catch (err) {
      error = err.message
    }
  }

  async function addReward(e) {
    e.preventDefault()
    if (!newRewardRoleId.trim() || !guildId) return
    error = ''
    rewardMessage = ''
    try {
      await api.saveReward(guildId, Number(newRewardLevel), newRewardRoleId.trim())
      rewardMessage = `Reward for Level ${newRewardLevel} set.`
      newRewardRoleId = ''
      const res = await api.getRewards(guildId)
      rewards = res.rewards || []
    } catch (err) {
      error = err.message
    }
  }

  async function deleteReward(lvl) {
    if (!guildId) return
    try {
      await api.deleteReward(guildId, lvl)
      rewards = rewards.filter((r) => r.level !== lvl)
    } catch (err) {
      error = err.message
    }
  }

  $effect(() => {
    if (guildId) loadAll()
  })
</script>

<section>
  <h2>API &amp; Integrations</h2>

  {#if stats}
    <div class="mult" style="margin-bottom: 1.5rem; background: var(--bg-alt, rgba(255,255,255,0.03)); padding: 1rem; border-radius: 6px;">
      <div>
        <span class="hint">Total Members</span>
        <div style="font-size: 1.25rem; font-weight: 700;">{stats.totalMembers?.toLocaleString()}</div>
      </div>
      <div>
        <span class="hint">Total Server XP</span>
        <div style="font-size: 1.25rem; font-weight: 700;">{stats.totalXp?.toLocaleString()}</div>
      </div>
      <div>
        <span class="hint">Top Level</span>
        <div style="font-size: 1.25rem; font-weight: 700;">Level {stats.topLevel}</div>
      </div>
    </div>
  {/if}

  <div class="actions" style="margin-bottom: 1.5rem;">
    <a href="/api/v1/docs" target="_blank" class="button" style="text-decoration: none; padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 4px;">
      Open Interactive API Docs
    </a>
    <a href="/api/v1/openapi.json" target="_blank" class="button" style="text-decoration: none; padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 4px;">
      OpenAPI 3.0 Spec JSON
    </a>
  </div>

  <h3>Developer API Keys</h3>
  <p class="hint">
    Use these keys with <code>Authorization: YOUR_KEY</code> or <code>X-API-Key</code> for Amari-compatible leaderboards and member queries.
  </p>

  {#if generatedKey}
    <div style="background: rgba(37,99,235,0.1); border: 1px solid #2563eb; padding: 1rem; border-radius: 6px; margin: 1rem 0;">
      <strong>Your new API key (copy now, it will not be shown again):</strong>
      <pre style="margin: 0.5rem 0 0; padding: 0.5rem; background: #111; user-select: all;"><code>{generatedKey}</code></pre>
    </div>
  {/if}

  <form onsubmit={createKey} style="margin-bottom: 1.5rem;">
    <label>
      Key label
      <input type="text" placeholder="e.g. Bot Integration, Web Leaderboard" bind:value={newKeyLabel} required />
    </label>
    {#if guildId}
      <label class="check" style="margin-top: 0.5rem;">
        <input type="checkbox" bind:checked={newKeyGuildScoped} />
        Scope key to server {guildId}
      </label>
    {/if}
    <div class="actions" style="margin-top: 0.75rem;">
      <button type="submit">Create API Key</button>
    </div>
  </form>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 2rem;">
    <thead>
      <tr style="text-align: left; border-bottom: 1px solid var(--border);">
        <th style="padding: 0.5rem;">Label</th>
        <th style="padding: 0.5rem;">Scope</th>
        <th style="padding: 0.5rem;">Created</th>
      </tr>
    </thead>
    <tbody>
      {#each keys as k}
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 0.5rem;">{k.label}</td>
          <td style="padding: 0.5rem;">{k.guild_id ? `Server ${k.guild_id}` : 'Global'}</td>
          <td style="padding: 0.5rem;">{new Date(k.created_at).toLocaleDateString()}</td>
        </tr>
      {:else}
        <tr><td colspan="3" style="padding: 1rem;" class="hint">No API keys generated yet.</td></tr>
      {/each}
    </tbody>
  </table>

  {#if guildId}
    <h3>Role Rewards (Amari-Compatible)</h3>
    <p class="hint">Assign Discord role IDs automatically when a user achieves a specific level.</p>

    <form onsubmit={addReward} style="margin-bottom: 1.5rem;">
      <div class="mult">
        <label>
          Level
          <input type="number" min="1" max="1000" bind:value={newRewardLevel} required />
        </label>
        <label>
          Discord Role ID
          <input type="text" placeholder="e.g. 123456789012345678" bind:value={newRewardRoleId} required />
        </label>
      </div>
      <div class="actions" style="margin-top: 0.75rem;">
        <button type="submit">Set Role Reward</button>
        {#if rewardMessage}<span class="ok">{rewardMessage}</span>{/if}
      </div>
    </form>

    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 1px solid var(--border);">
          <th style="padding: 0.5rem;">Level</th>
          <th style="padding: 0.5rem;">Role ID</th>
          <th style="padding: 0.5rem;">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each rewards as r}
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 0.5rem;">Level {r.level}</td>
            <td style="padding: 0.5rem;"><code>{r.roleId || r.role_id}</code></td>
            <td style="padding: 0.5rem;">
              <button type="button" class="danger" onclick={() => deleteReward(r.level)}>Remove</button>
            </td>
          </tr>
        {:else}
          <tr><td colspan="3" style="padding: 1rem;" class="hint">No role rewards configured.</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if error}
    <p class="error" style="margin-top: 1rem;">{error}</p>
  {/if}
</section>
