import type {
  ApiErrorCode,
  ApiErrorDto,
  BulkMembersResponseDto,
  GuildDto,
  LeaderboardEntryDto,
  LeaderboardPageDto,
  LeaderboardScope,
  MemberDto,
  MemberRankDto,
  PageOptions,
  RequestOptions,
  RewardsDto,
} from "@inochi/api-contract";

export type {
  ApiErrorCode,
  ApiErrorDto,
  BulkMembersRequestDto,
  BulkMembersResponseDto,
  GuildDto,
  LeaderboardEntryDto,
  LeaderboardPageDto,
  LeaderboardScope,
  MemberDto,
  MemberRankDto,
  PageOptions,
  RequestOptions,
  RewardDto,
  RewardsDto,
} from "@inochi/api-contract";

export interface InochiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  authentication?: "bearer" | "x-api-key";
}

export class InochiApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "invalid_response";
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: { status: number; code: ApiErrorCode | "invalid_response"; requestId?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "InochiApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export class InochiRateLimitError extends InochiApiError {
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { requestId?: string; details?: Record<string, unknown>; retryAfterMs: number | null }) {
    super(message, { status: 429, code: "rate_limited", requestId: options.requestId, details: options.details });
    this.name = "InochiRateLimitError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

function retryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export class InochiClient {
  readonly guild: { get: (guildId: string, options?: RequestOptions) => Promise<GuildDto> };
  readonly members: {
    get: (guildId: string, userId: string, options?: RequestOptions) => Promise<MemberDto>;
    bulk: (guildId: string, userIds: string[], options?: RequestOptions) => Promise<BulkMembersResponseDto>;
    rank: (guildId: string, userId: string, scope?: LeaderboardScope, options?: RequestOptions) => Promise<MemberRankDto>;
  };
  readonly leaderboards: {
    total: (guildId: string, options?: PageOptions) => Promise<LeaderboardPageDto>;
    weekly: (guildId: string, options?: PageOptions) => Promise<LeaderboardPageDto>;
    iterateTotal: (guildId: string, options?: PageOptions) => AsyncGenerator<LeaderboardEntryDto>;
    iterateWeekly: (guildId: string, options?: PageOptions) => AsyncGenerator<LeaderboardEntryDto>;
  };
  readonly rewards: { list: (guildId: string, options?: RequestOptions) => Promise<RewardsDto> };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly authentication: "bearer" | "x-api-key";

  constructor(options: InochiClientOptions) {
    if (!options.apiKey) throw new TypeError("apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000/api/v1").replace(/\/+$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.authentication = options.authentication ?? "bearer";

    this.guild = { get: (guildId, requestOptions) => this.request(`/guilds/${encodeURIComponent(guildId)}`, undefined, requestOptions) };
    this.members = {
      get: (guildId, userId, requestOptions) => this.request(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, undefined, requestOptions),
      bulk: (guildId, userIds, requestOptions) => this.request(`/guilds/${encodeURIComponent(guildId)}/members/bulk`, { method: "POST", body: JSON.stringify({ userIds }) }, requestOptions),
      rank: (guildId, userId, scope = "total", requestOptions) => this.request(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/rank?scope=${scope}`, undefined, requestOptions),
    };
    this.leaderboards = {
      total: (guildId, pageOptions) => this.leaderboard(guildId, "total", pageOptions),
      weekly: (guildId, pageOptions) => this.leaderboard(guildId, "weekly", pageOptions),
      iterateTotal: (guildId, pageOptions) => this.iterateLeaderboard(guildId, "total", pageOptions),
      iterateWeekly: (guildId, pageOptions) => this.iterateLeaderboard(guildId, "weekly", pageOptions),
    };
    this.rewards = { list: (guildId, requestOptions) => this.request(`/guilds/${encodeURIComponent(guildId)}/rewards`, undefined, requestOptions) };
  }

  private leaderboard(guildId: string, scope: LeaderboardScope, options: PageOptions = {}) {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    const suffix = query.size ? `?${query}` : "";
    return this.request<LeaderboardPageDto>(`/guilds/${encodeURIComponent(guildId)}/leaderboards/${scope}${suffix}`, undefined, options);
  }

  private async *iterateLeaderboard(guildId: string, scope: LeaderboardScope, options: PageOptions = {}): AsyncGenerator<LeaderboardEntryDto> {
    let cursor = options.cursor;
    const seen = new Set<string>();
    do {
      if (cursor && seen.has(cursor)) throw new InochiApiError("API returned a repeated pagination cursor", { status: 502, code: "invalid_response" });
      if (cursor) seen.add(cursor);
      const page = await this.leaderboard(guildId, scope, { ...options, cursor });
      yield* page.members;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  private async request<T>(path: string, init: RequestInit | undefined, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), options.timeoutMs ?? this.timeoutMs);
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (init?.body) headers.set("content-type", "application/json");
    headers.set(this.authentication === "bearer" ? "authorization" : "x-api-key", this.authentication === "bearer" ? `Bearer ${this.apiKey}` : this.apiKey);

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        if (body === null) throw new InochiApiError("API returned an invalid JSON response", { status: response.status, code: "invalid_response" });
        return body as T;
      }
      const apiError = body as Partial<ApiErrorDto> | null;
      const error = apiError?.error;
      const message = error?.message ?? `API request failed with status ${response.status}`;
      if (response.status === 429) throw new InochiRateLimitError(message, { requestId: error?.requestId, details: error?.details, retryAfterMs: retryAfterMs(response.headers.get("retry-after")) });
      throw new InochiApiError(message, { status: response.status, code: error?.code ?? "invalid_response", requestId: error?.requestId, details: error?.details });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
