// Thin API client. The admin token is entered once per browser session and
// kept in localStorage; Discord OAuth sessions replace this in phase 2.

const BASE = import.meta.env.VITE_API_BASE ?? ''

export function getToken() {
  return localStorage.getItem('inochi.token') ?? ''
}

export function setToken(token) {
  if (token) localStorage.setItem('inochi.token', token)
  else localStorage.removeItem('inochi.token')
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText)
  return body
}

export const api = {
  health: () => request('/api/health'),
  leaderboard: (guildId, { weekly = false, limit = 25 } = {}) =>
    request(
      `/api/guilds/${guildId}/leaderboard?weekly=${weekly}&limit=${limit}`,
    ),
  getSettings: (guildId) => request(`/api/guilds/${guildId}/settings`),
  saveSettings: (guildId, settings, actorId) =>
    request(`/api/guilds/${guildId}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ settings, actor_id: actorId }),
    }),
}
