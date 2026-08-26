<script>
  import { api, getToken, setToken } from './api'

  let health = $state(null)
  let tokenInput = $state(getToken())
  let saved = $state('')

  async function check() {
    health = null
    try {
      health = await api.health()
    } catch {
      health = { status: 'unreachable' }
    }
  }
</script>

<section>
  <h2>Connection</h2>
  <form onsubmit={(e) => { e.preventDefault(); setToken(tokenInput.trim()); saved = 'Token stored.'; check() }}>
    <label>
      Admin API token
      <input type="password" bind:value={tokenInput} placeholder="ADMIN_TOKEN" />
    </label>
    <div class="actions">
      <button type="submit">Save &amp; test</button>
      {#if saved}<span class="ok">{saved}</span>{/if}
    </div>
  </form>

  <h2>API health</h2>
  {#if health === null}
    <p class="hint">Not checked yet.</p>
  {:else}
    <pre>{JSON.stringify(health, null, 2)}</pre>
  {/if}
</section>
