# Inochi Public REST API Documentation

The Inochi API is a high-performance REST API providing Discord leveling data, member lookups, leaderboards, role rewards, and server statistics. It is designed for maximum efficiency in Rust (Axum), providing sub-millisecond response latencies and full support for both modern client integrations and drop-in compatibility with **AmariBot** API patterns.

---

## Quick Navigation

- [Authentication](#authentication)
- [AmariBot API Comparison & Migration](#amaribot-api-comparison--migration)
- [Endpoints Overview](#endpoints-overview)
  - [1. Get Member Profile](#1-get-member-profile)
  - [2. Bulk Get Members](#2-bulk-get-members)
  - [3. Get Guild Leaderboard](#3-get-guild-leaderboard)
  - [4. Get Weekly Leaderboard](#4-get-weekly-leaderboard)
  - [5. Get Raw Leaderboard](#5-get-raw-leaderboard)
  - [6. Get Role Rewards](#6-get-role-rewards)
  - [7. Manage Role Rewards (Admin)](#7-manage-role-rewards-admin)
  - [8. Get Guild Statistics](#8-get-guild-statistics)
  - [9. OpenAPI Specification & Interactive Docs](#9-openapi-specification--interactive-docs)
- [Code Examples](#code-examples)
  - [Python (aiohttp / requests)](#python-async-client)
  - [JavaScript / TypeScript (Fetch / Node.js)](#javascript--typescript)
  - [cURL](#curl-examples)
- [Status Codes & Error Handling](#status-codes--error-handling)

---

## Authentication

All API endpoints are protected and require a valid token or API key. Inochi supports **three** flexible authentication header schemes:

### 1. AmariBot Style (Direct Header)
Pass your API key directly as the value of the `Authorization` header:
```http
Authorization: YOUR_INOCHI_API_KEY
```

### 2. Bearer Authentication
Standard Bearer token format (supports developer API keys or instance Admin tokens):
```http
Authorization: Bearer YOUR_INOCHI_API_KEY
```

### 3. Dedicated `X-API-Key` Header
Pass your API key via the custom header:
```http
X-API-Key: YOUR_INOCHI_API_KEY
```

> **Note:** API keys can be scoped to a single Discord Guild (server) or granted global access. If a scoped key attempts to query another guild, the API responds with `403 Forbidden`.

---

## AmariBot API Comparison & Migration

Inochi was engineered to provide a familiar and seamless experience for developers migrating from or integrating alongside AmariBot, with key enhancements:

| Feature / Intent | AmariBot Endpoint | Inochi Endpoint | Notes |
| :--- | :--- | :--- | :--- |
| **Member Profile** | `GET /api/v10/guild/:gid/member/:uid` | `GET /api/v1/guilds/:gid/members/:uid`<br>*(alias: `/api/v1/guild/:gid/member/:uid`)* | Both `id` and `userId`, `rank` and `position` are returned. |
| **Bulk Members** | `POST /api/v10/guild/:gid/members` | `POST /api/v1/guilds/:gid/members`<br>*(also supports `GET ?uids=1,2`)* | Fast single-query SQL CTE; supports both `{"members": [...]}` and `{"uids": [...]}` |
| **Leaderboard** | `GET /api/v10/guild/leaderboard/:gid` | `GET /api/v1/guilds/:gid/leaderboard` | Supports `page` (1-indexed) or `offset` (0-indexed) & `limit`. |
| **Weekly Leaderboard** | `GET /api/v10/guild/weekly/:gid` | `GET /api/v1/guilds/:gid/weekly` | Auto-resets on ISO Monday 00:00 UTC. |
| **Raw Leaderboard** | `GET /api/v10/guild/raw/leaderboard/:gid` | `GET /api/v1/guilds/:gid/raw/leaderboard` | Compact array representation for lightweight parsing. |
| **Role Rewards** | `GET /api/v10/guild/rewards/:gid` | `GET /api/v1/guilds/:gid/rewards` | Returns all level-to-role mappings. |
| **Guild Stats** | *(Not available in Amari)* | `GET /api/v1/guilds/:gid/stats` | Returns total XP, active member count, max level. |

### Field Compatibility Table

| Concept | AmariBot Field | Inochi Equivalent |
| :--- | :--- | :--- |
| Discord User ID | `id` | `userId` & `id` (both present) |
| Total Experience | `exp` | `xp` |
| Weekly Experience | `weeklyExp` | `weeklyXp` |
| Calculated Level | `level` | `level` |
| Leaderboard Position | `position` | `position` & `rank` (both present) |
| Daily Chat Streak | *(None)* | `dailyStreak` |

---

## Endpoints Overview

### 1. Get Member Profile

Retrieve XP, weekly XP, level, rank, and streak for a specific guild member.

- **Route:** `GET /api/v1/guilds/{guildId}/members/{userId}`
- **Alias:** `GET /api/v1/guild/{guildId}/member/{userId}`

#### Path Parameters
- `guildId` *(string | int64)*: The Discord Guild ID.
- `userId` *(string | int64)*: The Discord User ID.

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "userId": "987654321098765432",
  "id": "987654321098765432",
  "xp": 14520,
  "weeklyXp": 850,
  "level": 14,
  "position": 3,
  "rank": 3,
  "dailyStreak": 5
}
```

---

### 2. Bulk Get Members

Fetch levels and ranks for up to 100 members in a single fast query.

- **Route:** `POST /api/v1/guilds/{guildId}/members`
- **Alternative:** `GET /api/v1/guilds/{guildId}/members?uids=id1,id2,id3`

#### Request Body (`POST`)
```json
{
  "members": [
    "987654321098765432",
    "876543210987654321"
  ]
}
```

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "total": 2,
  "members": [
    {
      "userId": "987654321098765432",
      "id": "987654321098765432",
      "xp": 14520,
      "weeklyXp": 850,
      "level": 14,
      "position": 3,
      "rank": 3,
      "dailyStreak": 5
    },
    {
      "userId": "876543210987654321",
      "id": "876543210987654321",
      "xp": 8200,
      "weeklyXp": 320,
      "level": 9,
      "position": 12,
      "rank": 12,
      "dailyStreak": 2
    }
  ]
}
```

---

### 3. Get Guild Leaderboard

Retrieve the all-time guild XP leaderboard ordered from highest to lowest XP.

- **Route:** `GET /api/v1/guilds/{guildId}/leaderboard`

#### Query Parameters
- `page` *(integer, optional, default: 1)*: 1-indexed page number.
- `limit` *(integer, optional, default: 50, max: 100)*: Members per page.
- `offset` *(integer, optional)*: Zero-indexed row offset (alternative to `page`).

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "kind": "total",
  "page": 1,
  "limit": 50,
  "total": 1240,
  "totalPages": 25,
  "entries": [
    {
      "userId": "987654321098765432",
      "id": "987654321098765432",
      "position": 1,
      "rank": 1,
      "xp": 54200,
      "weeklyXp": 3100,
      "level": 28
    }
  ]
}
```

---

### 4. Get Weekly Leaderboard

Retrieve the weekly XP leaderboard. Automatically resets every Monday at 00:00 UTC.

- **Route:** `GET /api/v1/guilds/{guildId}/weekly`

#### Query Parameters
- `page` *(integer, optional, default: 1)*
- `limit` *(integer, optional, default: 50, max: 100)*

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "kind": "weekly",
  "page": 1,
  "limit": 50,
  "total": 450,
  "totalPages": 9,
  "entries": [
    {
      "userId": "987654321098765432",
      "id": "987654321098765432",
      "position": 1,
      "rank": 1,
      "xp": 3100,
      "weeklyXp": 3100,
      "level": 28
    }
  ]
}
```

---

### 5. Get Raw Leaderboard

Ultra-compact array payload designed for lightweight bot caching and minimal bandwidth.

- **Route:** `GET /api/v1/guilds/{guildId}/raw/leaderboard`

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "page": 1,
  "limit": 50,
  "total": 1240,
  "data": [
    { "id": "987654321098765432", "xp": 54200, "weeklyXp": 3100 },
    { "id": "876543210987654321", "xp": 38100, "weeklyXp": 1200 }
  ]
}
```

---

### 6. Get Role Rewards

List all configured level-to-role rewards for the server.

- **Route:** `GET /api/v1/guilds/{guildId}/rewards`

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "count": 3,
  "rewards": [
    { "level": 5, "roleId": "111222333444555666" },
    { "level": 10, "roleId": "222333444555666777" },
    { "level": 25, "roleId": "333444555666777888" }
  ]
}
```

---

### 7. Manage Role Rewards (Admin)

Create, update, or remove level role rewards. Requires Admin bearer token.

- **Create/Update:** `POST /api/v1/guilds/{guildId}/rewards`
  ```json
  { "level": 15, "roleId": "444555666777888999" }
  ```
- **Delete:** `DELETE /api/v1/guilds/{guildId}/rewards/{level}`

---

### 8. Get Guild Statistics

High-level summary of the server's leveling economy.

- **Route:** `GET /api/v1/guilds/{guildId}/stats`

#### Response `200 OK`
```json
{
  "guildId": "123456789012345678",
  "totalMembers": 1240,
  "totalXp": 4820150,
  "topXp": 54200,
  "topLevel": 28,
  "rewardsCount": 3
}
```

---

### 9. OpenAPI Specification & Interactive Docs

- **OpenAPI 3.0 JSON Schema:** `GET /api/v1/openapi.json`
- **Interactive Documentation UI:** Visit `/docs` or the **API Docs** tab in the Inochi Dashboard.

---

## Code Examples

### Python (Async Client)

```python
import aiohttp
import asyncio

class InochiClient:
    def __init__(self, api_key: str, base_url: str = "http://localhost:3000"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        # Amari-compatible Authorization header
        self.headers = {"Authorization": self.api_key}

    async def get_member(self, guild_id: int, user_id: int):
        url = f"{self.base_url}/api/v1/guilds/{guild_id}/members/{user_id}"
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.get(url) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def get_leaderboard(self, guild_id: int, page: int = 1, limit: int = 50):
        url = f"{self.base_url}/api/v1/guilds/{guild_id}/leaderboard"
        params = {"page": page, "limit": limit}
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.get(url, params=params) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def get_members_bulk(self, guild_id: int, user_ids: list[str]):
        url = f"{self.base_url}/api/v1/guilds/{guild_id}/members"
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.post(url, json={"members": user_ids}) as resp:
                resp.raise_for_status()
                return await resp.json()

# Example usage:
async def main():
    client = InochiClient("your_api_key_here")
    member = await client.get_member(123456789012345678, 987654321098765432)
    print(f"Level: {member['level']} | Rank: #{member['position']} | XP: {member['xp']}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

### JavaScript / TypeScript

```typescript
export class InochiAPI {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'http://localhost:3000') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey, // Amari-compatible
        ...(options.headers || {}),
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Get single member profile
  getMember(guildId: string, userId: string) {
    return this.request(`/api/v1/guilds/${guildId}/members/${userId}`);
  }

  // Bulk query members
  getMembers(guildId: string, userIds: string[]) {
    return this.request(`/api/v1/guilds/${guildId}/members`, {
      method: 'POST',
      body: JSON.stringify({ members: userIds }),
    });
  }

  // Leaderboard
  getLeaderboard(guildId: string, page = 1, limit = 50) {
    return this.request(`/api/v1/guilds/${guildId}/leaderboard?page=${page}&limit=${limit}`);
  }

  // Weekly Leaderboard
  getWeeklyLeaderboard(guildId: string, page = 1, limit = 50) {
    return this.request(`/api/v1/guilds/${guildId}/weekly?page=${page}&limit=${limit}`);
  }

  // Role rewards
  getRewards(guildId: string) {
    return this.request(`/api/v1/guilds/${guildId}/rewards`);
  }
}
```

---

### cURL Examples

```bash
# 1. Fetch member profile
curl -H "Authorization: YOUR_KEY" \
  http://localhost:3000/api/v1/guilds/1234567890/members/987654321

# 2. Bulk fetch members
curl -X POST \
  -H "Authorization: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"members": ["987654321", "876543210"]}' \
  http://localhost:3000/api/v1/guilds/1234567890/members

# 3. Leaderboard page 1
curl -H "Authorization: YOUR_KEY" \
  "http://localhost:3000/api/v1/guilds/1234567890/leaderboard?page=1&limit=25"

# 4. Role rewards
curl -H "Authorization: YOUR_KEY" \
  http://localhost:3000/api/v1/guilds/1234567890/rewards
```

---

## Status Codes & Error Handling

All errors return standard HTTP status codes with a JSON error body:

```json
{
  "error": "description of the error"
}
```

| Status Code | Description | Reason |
| :--- | :--- | :--- |
| `200 OK` | Success | Request succeeded. |
| `400 Bad Request` | Invalid Input | Malformed JSON, non-numeric IDs, or invalid parameters. |
| `401 Unauthorized` | Authentication Failed | Missing or invalid API key / bearer token. |
| `403 Forbidden` | Scoped Key Mismatch | The API key is restricted to a different Discord guild. |
| `404 Not Found` | Resource Not Found | Member has not earned XP yet, or guild has not set up leveling. |
| `500 Internal Server Error` | Server Error | Database or internal service failure. |
