// Thin API client.
//
// Auth: Discord OAuth session cookie when configured (see /auth/me), with
// the admin token as the manual fallback for self-hosters.

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
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
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
  audit: (guildId) => request(`/api/guilds/${guildId}/audit`),
  me: () => request('/auth/me'),
  createKey: (label, guildId) =>
    request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ label, guild_id: guildId || null }),
    }),
  listKeys: () => request('/api/keys'),
}

export const loginUrl = () => `${BASE}/auth/login`
