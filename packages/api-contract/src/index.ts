export const API_VERSION = "v1" as const;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGINATION_OFFSET = 10_000;
export const MAX_BULK_MEMBER_IDS = 100;

export type Snowflake = string;
export type LeaderboardScope = "total" | "weekly";
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "internal_error";

export interface ApiErrorDto {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export interface GuildDto {
  id: Snowflake;
  name: string | null;
  icon: string | null;
  enabled: boolean;
  joinedAt: string | null;
  leaderboard: {
    enabled: boolean;
    minimumLevel: number;
    maximumEntries: number | null;
  };
  weeklyXpEnabled: boolean;
}

export interface MemberDto {
  userId: Snowflake;
  xp: number;
  weeklyXp: number;
  level: number;
  messageCount: number;
  updatedAt: string;
}

export interface BulkMembersRequestDto {
  userIds: Snowflake[];
}

export interface BulkMembersResponseDto {
  members: MemberDto[];
  missingUserIds: Snowflake[];
}

export interface LeaderboardEntryDto extends MemberDto {
  rank: number;
  score: number;
}

export interface LeaderboardPageDto {
  scope: LeaderboardScope;
  members: LeaderboardEntryDto[];
  nextCursor: string | null;
}

export interface MemberRankDto {
  scope: LeaderboardScope;
  userId: Snowflake;
  rank: number;
  score: number;
}

export interface RewardDto {
  roleId: Snowflake;
  level: number;
  keep: boolean;
  noSync: boolean;
}

export interface RewardsDto {
  rewards: RewardDto[];
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PageOptions extends RequestOptions {
  limit?: number;
  cursor?: string;
}

export type OpenApiDocument = Record<string, unknown>;
