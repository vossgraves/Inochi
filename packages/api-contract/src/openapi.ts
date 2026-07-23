import type { OpenApiDocument } from "./index";

const MAX_BULK_MEMBER_IDS = 100;
const MAX_PAGE_SIZE = 100;

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string", enum: ["bad_request", "unauthorized", "not_found", "rate_limited", "internal_error"] },
        message: { type: "string" },
        requestId: { type: "string", format: "uuid" },
        details: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

const memberSchema = {
  type: "object",
  required: ["userId", "xp", "weeklyXp", "level", "messageCount", "updatedAt"],
  properties: {
    userId: { type: "string", pattern: "^\\d{16,20}$" },
    xp: { type: "integer", minimum: 0 },
    weeklyXp: { type: "integer", minimum: 0 },
    level: { type: "integer", minimum: 0 },
    messageCount: { type: "integer", minimum: 0 },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const responses = (schema: Record<string, unknown>) => ({
  "200": { description: "Success", content: { "application/json": { schema } } },
  "400": { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
  "401": { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
  "404": { description: "Resource not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
  "429": { description: "Rate limit exceeded", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
});

const guildParameter = { name: "guildId", in: "path", required: true, schema: { type: "string", pattern: "^\\d{16,20}$" } };
const userParameter = { name: "userId", in: "path", required: true, schema: { type: "string", pattern: "^\\d{16,20}$" } };
const pageParameters = [
  guildParameter,
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor returned by the previous page." },
];

export const openApiDocument: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "Inochi Read API", version: "1.0.0", description: "Authenticated, read-only guild progression API." },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {
    "/guilds/{guildId}": { get: { operationId: "getGuild", summary: "Guild metadata", parameters: [guildParameter], responses: responses({ $ref: "#/components/schemas/Guild" }) } },
    "/guilds/{guildId}/members/{userId}": { get: { operationId: "getMember", summary: "Member progression", parameters: [guildParameter, userParameter], responses: responses({ $ref: "#/components/schemas/Member" }) } },
    "/guilds/{guildId}/members/bulk": {
      post: {
        operationId: "getMembers",
        summary: "Bulk member lookup",
        parameters: [guildParameter],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["userIds"], properties: { userIds: { type: "array", minItems: 1, maxItems: MAX_BULK_MEMBER_IDS, uniqueItems: true, items: { type: "string", pattern: "^\\d{16,20}$" } } } } } } },
        responses: responses({ type: "object", required: ["members", "missingUserIds"], properties: { members: { type: "array", items: { $ref: "#/components/schemas/Member" } }, missingUserIds: { type: "array", items: { type: "string" } } } }),
      },
    },
    "/guilds/{guildId}/leaderboards/total": { get: { operationId: "getTotalLeaderboard", summary: "Total XP leaderboard", parameters: pageParameters, responses: responses({ $ref: "#/components/schemas/LeaderboardPage" }) } },
    "/guilds/{guildId}/leaderboards/weekly": { get: { operationId: "getWeeklyLeaderboard", summary: "Weekly XP leaderboard", parameters: pageParameters, responses: responses({ $ref: "#/components/schemas/LeaderboardPage" }) } },
    "/guilds/{guildId}/members/{userId}/rank": {
      get: { operationId: "getMemberRank", summary: "Member rank", parameters: [guildParameter, userParameter, { name: "scope", in: "query", schema: { type: "string", enum: ["total", "weekly"], default: "total" } }], responses: responses({ $ref: "#/components/schemas/MemberRank" }) },
    },
    "/guilds/{guildId}/rewards": { get: { operationId: "getRewards", summary: "Configured level rewards", parameters: [guildParameter], responses: responses({ $ref: "#/components/schemas/Rewards" }) } },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "API key sent as a Bearer token." },
      apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      ApiError: errorSchema,
      Member: memberSchema,
      Guild: {
        type: "object",
        required: ["id", "name", "icon", "enabled", "joinedAt", "leaderboard", "weeklyXpEnabled"],
        properties: {
          id: { type: "string" }, name: { type: ["string", "null"] }, icon: { type: ["string", "null"] }, enabled: { type: "boolean" }, joinedAt: { type: ["string", "null"], format: "date-time" },
          leaderboard: { type: "object", required: ["enabled", "minimumLevel", "maximumEntries"], properties: { enabled: { type: "boolean" }, minimumLevel: { type: "integer" }, maximumEntries: { type: ["integer", "null"] } } },
          weeklyXpEnabled: { type: "boolean" },
        },
      },
      LeaderboardPage: { type: "object", required: ["scope", "members", "nextCursor"], properties: { scope: { type: "string", enum: ["total", "weekly"] }, members: { type: "array", items: { allOf: [{ $ref: "#/components/schemas/Member" }, { type: "object", required: ["rank", "score"], properties: { rank: { type: "integer" }, score: { type: "integer" } } }] } }, nextCursor: { type: ["string", "null"] } } },
      MemberRank: { type: "object", required: ["scope", "userId", "rank", "score"], properties: { scope: { type: "string", enum: ["total", "weekly"] }, userId: { type: "string" }, rank: { type: "integer" }, score: { type: "integer" } } },
      Rewards: { type: "object", required: ["rewards"], properties: { rewards: { type: "array", items: { type: "object", required: ["roleId", "level", "keep", "noSync"], properties: { roleId: { type: "string" }, level: { type: "integer" }, keep: { type: "boolean" }, noSync: { type: "boolean" } } } } } },
    },
  },
};
