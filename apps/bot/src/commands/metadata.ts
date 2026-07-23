export type CommandCategory = "member" | "admin";
export type CommandOptionType = "attachment" | "boolean" | "channel" | "integer" | "number" | "role" | "string" | "user";

export interface CommandOptionMetadata {
  readonly name: string;
  readonly type: CommandOptionType;
  readonly description: string;
  readonly required?: boolean;
  readonly choices?: readonly string[];
}

export interface CommandSubcommandMetadata {
  readonly name: string;
  readonly description: string;
  readonly options: readonly CommandOptionMetadata[];
}

export interface CommandMetadata {
  readonly name: string;
  readonly category: CommandCategory;
  readonly description: string;
  /** Includes the canonical name to match the prefix command table. */
  readonly aliases: readonly string[];
  readonly slashUsage: readonly string[];
  /** Prefix-independent forms. Pass these through formatPrefixUsage before display. */
  readonly prefixUsage: readonly string[];
  readonly options: readonly CommandOptionMetadata[];
  readonly subcommands: readonly CommandSubcommandMetadata[];
  readonly permission: string;
  readonly examples: readonly string[];
  readonly planned?: boolean;
}

const memberPermission = "Available to every server member.";
const managerPermission = "Requires the Manage Server permission.";

export const commandRegistry = [
  {
    name: "rank", category: "member", description: "View your rank card or another member's rank card.",
    aliases: ["rank", "level", "lvl", "xp", "profile", "me", "r"],
    slashUsage: ["/rank", "/rank member:@member", "/rank member:@member hidden:true text_mode:true"],
    prefixUsage: ["rank", "rank @member"],
    options: [
      { name: "member", type: "user", description: "Member to view." },
      { name: "hidden", type: "boolean", description: "Only show the response to you." },
      { name: "text_mode", type: "boolean", description: "Show a lightweight text rank." },
    ], subcommands: [], permission: memberPermission,
    examples: ["/rank", "/rank member:@Inochi hidden:true", "{prefix}r @Inochi"],
  },
  {
    name: "top", category: "member", description: "View the server XP leaderboard or locate a member on it.",
    aliases: ["top", "leaderboard", "levels", "ranking", "ranks", "lb"],
    slashUsage: ["/top", "/top page:2", "/top member:@member"], prefixUsage: ["top", "top 2"],
    options: [
      { name: "page", type: "integer", description: "Leaderboard page, starting at 1." },
      { name: "member", type: "user", description: "Highlight a member." },
    ], subcommands: [], permission: memberPermission, examples: ["/top page:2", "{prefix}lb 2"],
  },
  {
    name: "weekly", category: "member", description: "View the weekly XP leaderboard or manage the weekly competition.",
    aliases: ["weekly", "week", "wtop"], slashUsage: ["/weekly", "/weekly action:show|enable|disable|reset"],
    prefixUsage: ["weekly", "weekly show|enable|disable|reset"],
    options: [{ name: "action", type: "string", description: "Weekly leaderboard action.", choices: ["show", "enable", "disable", "reset"] }],
    subcommands: [], permission: "Everyone can view it; enable, disable, and reset require Manage Server.",
    examples: ["/weekly", "/weekly action:reset", "{prefix}wtop"],
  },
  {
    name: "winner", category: "admin", description: "Choose and display the top three weekly XP winners.",
    aliases: ["winner", "winners"], slashUsage: ["/winner"], prefixUsage: ["winner"], options: [], subcommands: [],
    permission: managerPermission, examples: ["/winner", "{prefix}winners"],
  },
  {
    name: "joinrole", category: "admin", description: "Set the role granted when a member joins, or disable the join role.",
    aliases: ["joinrole", "autorole", "jr"], slashUsage: ["/joinrole role:@role", "/joinrole"], prefixUsage: ["joinrole @role", "joinrole"],
    options: [{ name: "role", type: "role", description: "Role to grant; omit it to disable the join role." }], subcommands: [],
    permission: `${managerPermission} Inochi also needs Manage Roles and must be above the selected role.`, examples: ["/joinrole role:@Member", "{prefix}jr @Member"],
  },
  {
    name: "blacklist", category: "admin", description: "Prevent selected roles from earning chat XP.",
    aliases: ["blacklist", "blockxp", "bl"], slashUsage: ["/blacklist action:show", "/blacklist action:add|remove role:@role"],
    prefixUsage: ["blacklist show", "blacklist add|remove @role"],
    options: [
      { name: "action", type: "string", description: "Add, remove, or show blocked roles.", required: true, choices: ["add", "remove", "show"] },
      { name: "role", type: "role", description: "Role to add or remove." },
    ], subcommands: [], permission: managerPermission, examples: ["/blacklist action:add role:@Bots", "{prefix}bl show"],
  },
  {
    name: "reset", category: "admin", description: "Reset one member's total XP, weekly XP, and cooldown.",
    aliases: ["reset", "resetxp"], slashUsage: ["/reset member:@member"], prefixUsage: ["reset @member"],
    options: [{ name: "member", type: "user", description: "Member whose progression will be reset.", required: true }], subcommands: [],
    permission: managerPermission, examples: ["/reset member:@Member", "{prefix}resetxp @Member"],
  },
  {
    name: "refresh", category: "admin", description: "Synchronize all reward roles or permanently clear all server points.",
    aliases: ["refresh", "refreshroles"], slashUsage: ["/refresh scope:roles", "/refresh scope:points confirmation:RESET"],
    prefixUsage: ["refresh roles", "refresh points RESET"],
    options: [
      { name: "scope", type: "string", description: "Reward roles or all points.", required: true, choices: ["roles", "points"] },
      { name: "confirmation", type: "string", description: "Type RESET when clearing all points." },
    ], subcommands: [], permission: managerPermission, examples: ["/refresh scope:roles", "{prefix}refresh points RESET"],
  },
  {
    name: "calculate", category: "member", description: "Calculate how much XP a member needs to reach a level.",
    aliases: ["calculate", "calc", "progress"], slashUsage: ["/calculate level:10", "/calculate level:10 member:@member"],
    prefixUsage: ["calculate 10", "calculate 10 @member"],
    options: [
      { name: "level", type: "integer", description: "Target level.", required: true },
      { name: "member", type: "user", description: "Member to calculate for; defaults to you." },
    ], subcommands: [], permission: memberPermission, examples: ["/calculate level:25", "{prefix}calc 25 @Member"],
  },
  {
    name: "sync", category: "member", description: "Synchronize level reward roles for yourself or another member.",
    aliases: ["sync", "syncroles"], slashUsage: ["/sync", "/sync member:@member"], prefixUsage: ["sync", "sync @member"],
    options: [{ name: "member", type: "user", description: "Member to synchronize; defaults to you." }], subcommands: [],
    permission: "Everyone can sync themselves; syncing another member requires Manage Server. Inochi needs Manage Roles.", examples: ["/sync", "{prefix}syncroles @Member"],
  },
  {
    name: "addxp", category: "admin", description: "Add, set, or modify a member's XP or level.",
    aliases: ["addxp", "givexp", "modifyxp", "modifyexp", "axp"],
    slashUsage: ["/addxp member:@member amount:100", "/addxp member:@member amount:10 operation:add_xp|set_xp|add_levels|set_level"],
    prefixUsage: ["addxp @member amount", "addxp @member amount add_xp|set_xp|add_levels|set_level"],
    options: [
      { name: "member", type: "user", description: "Member to modify.", required: true },
      { name: "amount", type: "integer", description: "XP or level amount.", required: true },
      { name: "operation", type: "string", description: "How to apply the amount; defaults to add_xp.", choices: ["add_xp", "set_xp", "add_levels", "set_level"] },
    ], subcommands: [], permission: managerPermission, examples: ["/addxp member:@Member amount:500", "{prefix}axp @Member 10 add_levels"],
  },
  {
    name: "clear", category: "admin", description: "Clear a member's chat XP cooldown.",
    aliases: ["clear", "clearcooldown"], slashUsage: ["/clear member:@member"], prefixUsage: ["clear @member"],
    options: [{ name: "member", type: "user", description: "Member whose cooldown will be cleared.", required: true }], subcommands: [],
    permission: managerPermission, examples: ["/clear member:@Member", "{prefix}clearcooldown @Member"],
  },
  {
    name: "config", category: "admin", description: "Open this server's web dashboard.",
    aliases: ["config", "settings", "dashboard", "dash", "cfg"], slashUsage: ["/config"], prefixUsage: ["config"], options: [], subcommands: [],
    permission: managerPermission, examples: ["/config", "{prefix}dashboard"],
  },
  {
    name: "setup", category: "admin", description: "Open the guided server setup.",
    aliases: ["setup", "wizard"], slashUsage: ["/setup"], prefixUsage: ["setup"], options: [], subcommands: [],
    permission: managerPermission, examples: ["/setup", "{prefix}wizard"],
  },
  {
    name: "rewardrole", category: "admin", description: "Add, update, or remove a level reward role.",
    aliases: ["rewardrole", "rewards", "reward", "levelroles", "rlevel", "rr"],
    slashUsage: ["/rewardrole role:@role level:10", "/rewardrole role:@role level:10 keep:true dont_sync:true", "/rewardrole role:@role level:0"],
    prefixUsage: ["rewardrole @role level", "rewardrole @role level keep dont_sync"],
    options: [
      { name: "role", type: "role", description: "Reward role.", required: true },
      { name: "level", type: "integer", description: "Level to award it at, or 0 to remove it.", required: true },
      { name: "keep", type: "boolean", description: "Keep this role after members earn higher rewards." },
      { name: "dont_sync", type: "boolean", description: "Do not synchronize this role automatically." },
    ], subcommands: [], permission: `${managerPermission} Inochi needs Manage Roles and must be above the reward role.`,
    examples: ["/rewardrole role:@Veteran level:25 keep:true", "{prefix}rr @Veteran 0"],
  },
  {
    name: "multiplier", category: "admin", description: "Configure role and channel XP multipliers.",
    aliases: ["multiplier", "multi", "pmulti"],
    slashUsage: ["/multiplier role role:@role value:2", "/multiplier channel channel:#channel value:1.5"],
    prefixUsage: ["multiplier role @role value", "multiplier channel #channel value"], options: [],
    subcommands: [
      { name: "role", description: "Set a role multiplier; 0 removes it.", options: [{ name: "role", type: "role", description: "Role.", required: true }, { name: "value", type: "number", description: "Multiplier from 0 to 100.", required: true }] },
      { name: "channel", description: "Set a channel multiplier; 0 removes it.", options: [{ name: "channel", type: "channel", description: "Channel.", required: true }, { name: "value", type: "number", description: "Multiplier from 0 to 100.", required: true }] },
    ], permission: managerPermission, examples: ["/multiplier role role:@Booster value:2", "{prefix}multi channel #chat 1.5"],
  },
  {
    name: "botstatus", category: "member", description: "Show Inochi's server count, shards, latency, and uptime.",
    aliases: ["botstatus", "status", "stats", "stat", "info", "ping"], slashUsage: ["/botstatus"], prefixUsage: ["botstatus"], options: [], subcommands: [],
    permission: memberPermission, examples: ["/botstatus", "{prefix}ping"],
  },
  {
    name: "word", category: "admin", description: "Start a word race in the current channel now.",
    aliases: ["word", "wordrace"], slashUsage: ["/word"], prefixUsage: ["word"], options: [], subcommands: [], permission: managerPermission,
    examples: ["/word", "{prefix}wordrace"],
  },
  {
    name: "maths", category: "admin", description: "Start a maths race in the current channel now.",
    aliases: ["maths", "math", "mathrace"], slashUsage: ["/maths"], prefixUsage: ["maths"], options: [], subcommands: [], permission: managerPermission,
    examples: ["/maths", "{prefix}mathrace"],
  },
  {
    name: "coinflip", category: "member", description: "Challenge another member to an XP coinflip.",
    aliases: ["coinflip", "cf", "coin", "flip"], slashUsage: ["/coinflip opponent:@member wager:100 side:heads|tails"],
    prefixUsage: ["coinflip @member wager heads|tails"],
    options: [
      { name: "opponent", type: "user", description: "Member to challenge.", required: true },
      { name: "wager", type: "integer", description: "XP wagered by each player.", required: true },
      { name: "side", type: "string", description: "Your chosen side.", required: true, choices: ["heads", "tails"] },
    ], subcommands: [], permission: memberPermission, examples: ["/coinflip opponent:@Member wager:100 side:heads", "{prefix}cf @Member 100 tails"],
  },
  {
    name: "vote", category: "member", description: "Vote for Inochi and check your active chat XP boost.",
    aliases: ["vote", "voteboost"], slashUsage: ["/vote"], prefixUsage: ["vote"], options: [], subcommands: [], permission: memberPermission,
    examples: ["/vote", "{prefix}voteboost"],
  },
  {
    name: "xpchannel", category: "admin", description: "Configure where chat XP can be earned.",
    aliases: ["xpchannel", "xpchannels", "channels"],
    slashUsage: ["/xpchannel list", "/xpchannel mode value:allowlist|denylist", "/xpchannel add channel:#channel", "/xpchannel remove channel:#channel", "/xpchannel threads enabled:true|false"],
    prefixUsage: ["xpchannel list", "xpchannel mode allowlist|denylist", "xpchannel add|remove #channel", "xpchannel threads on|off"], options: [],
    subcommands: [
      { name: "mode", description: "Set allowlist or denylist mode.", options: [{ name: "value", type: "string", description: "Policy mode.", required: true, choices: ["denylist", "allowlist"] }] },
      { name: "add", description: "Add a channel, category, forum, or thread.", options: [{ name: "channel", type: "channel", description: "Location.", required: true }] },
      { name: "remove", description: "Remove a configured location.", options: [{ name: "channel", type: "channel", description: "Location.", required: true }] },
      { name: "list", description: "List the current channel policy.", options: [] },
      { name: "threads", description: "Toggle XP inside eligible threads.", options: [{ name: "enabled", type: "boolean", description: "Whether thread XP is allowed.", required: true }] },
    ], permission: managerPermission, examples: ["/xpchannel add channel:#general", "/xpchannel mode value:allowlist", "{prefix}channels list"],
  },
  {
    name: "privacy", category: "member", description: "Control whether your identity is hidden on public leaderboards.",
    aliases: ["privacy", "private"], slashUsage: ["/privacy", "/privacy leaderboard:true|false"], prefixUsage: ["privacy", "privacy on|off"],
    options: [{ name: "leaderboard", type: "boolean", description: "Hide your identity on public leaderboards." }], subcommands: [], permission: memberPermission,
    examples: ["/privacy leaderboard:true", "{prefix}private off"],
  },
  {
    name: "colour", category: "member", description: "Set or reset your rank-card progress colour.",
    aliases: ["colour", "color"], slashUsage: ["/colour colour:#b5c6ff", "/colour"], prefixUsage: ["colour #b5c6ff", "colour reset"],
    options: [{ name: "colour", type: "string", description: "Six-digit hex colour; omit it to reset." }], subcommands: [], permission: memberPermission,
    examples: ["/colour colour:#b5c6ff", "{prefix}color reset"],
  },
  {
    name: "background", category: "member", description: "Upload, view, or delete your rank-card background.",
    aliases: ["background", "bg"], slashUsage: ["/background set image:attachment", "/background view", "/background delete"],
    prefixUsage: ["background set [attachment]", "background view", "background delete"], options: [],
    subcommands: [
      { name: "set", description: "Upload a PNG, JPEG, GIF, or WebP under 5 MB.", options: [{ name: "image", type: "attachment", description: "Background image.", required: true }] },
      { name: "view", description: "View your current background.", options: [] },
      { name: "delete", description: "Delete your custom background.", options: [] },
    ], permission: memberPermission, examples: ["/background view", "/background set image:background.png", "{prefix}bg delete"],
  },
  {
    name: "wrapped", category: "member", description: "View your Inochi activity summary for the current year.",
    aliases: ["wrapped", "summary"], slashUsage: ["/wrapped"], prefixUsage: ["wrapped"], options: [], subcommands: [], permission: memberPermission,
    examples: ["/wrapped", "{prefix}summary"],
  },
  {
    name: "help", category: "member", description: "View the command overview and command documentation.",
    aliases: ["help", "commands", "cmds", "h"], slashUsage: ["/help", "/help command:rank"], prefixUsage: ["help", "help command"],
    options: [{ name: "command", type: "string", description: "Command name or alias." }], subcommands: [], permission: memberPermission,
    examples: ["/help", "/help command:rank", "{prefix}commands top"],
  },
  {
    name: "diagnose", category: "admin", description: "Check Inochi's server configuration, references, and permissions.",
    aliases: ["diagnose", "doctor"], slashUsage: ["/diagnose"], prefixUsage: ["diagnose"], options: [], subcommands: [], permission: managerPermission,
    examples: ["/diagnose", "{prefix}doctor"],
  },
  {
    name: "import", category: "admin", description: "Import XP from another leveling bot or a supported data source.",
    aliases: ["import", "migrate"], slashUsage: ["/import", "/import source:provider"], prefixUsage: ["import", "import provider"],
    options: [{ name: "source", type: "string", description: "Source bot, or omit it to choose from the import panel." }], subcommands: [],
    permission: managerPermission, examples: ["/import", "{prefix}migrate mee6"],
  },
  {
    name: "leaderboard", category: "admin", description: "Configure the persistent Discord leaderboard.",
    aliases: ["leaderboard"], slashUsage: ["/leaderboard setup channel:#levels rows:10", "/leaderboard status|refresh|disable"], prefixUsage: ["leaderboard"], options: [],
    subcommands: [
      { name: "setup", description: "Create or move the persistent leaderboard.", options: [{ name: "channel", type: "channel", description: "Leaderboard channel.", required: true }, { name: "rows", type: "integer", description: "Number of members to show." }] },
      { name: "status", description: "Show the current persistent leaderboard status.", options: [] },
      { name: "refresh", description: "Refresh the persistent leaderboard now.", options: [] },
      { name: "disable", description: "Remove the persistent leaderboard.", options: [] },
    ], permission: managerPermission, examples: ["/leaderboard setup channel:#levels", "/leaderboard refresh"],
  },
] as const satisfies readonly CommandMetadata[];

export type CommandName = (typeof commandRegistry)[number]["name"];

function isPlanned(command: CommandMetadata) {
  return command.planned === true;
}

export const currentCommandRegistry: readonly CommandMetadata[] = commandRegistry.filter((command) => !isPlanned(command));
export const memberCommands: readonly CommandMetadata[] = commandRegistry.filter((command) => command.category === "member" && !isPlanned(command));
export const administratorCommands: readonly CommandMetadata[] = commandRegistry.filter((command) => command.category === "admin" && !isPlanned(command));

const canonicalCommands = new Map<string, CommandMetadata>(commandRegistry.map((command) => [command.name, command]));
const commandNames = new Map<string, CommandMetadata>();
for (const command of commandRegistry) {
  for (const alias of command.aliases) if (!commandNames.has(alias)) commandNames.set(alias, command);
}
// Canonical slash names win over aliases. Prefix resolution below excludes planned commands,
// preserving `leaderboard` as an alias of the current `top` prefix command.
for (const command of commandRegistry) commandNames.set(command.name, command);

function normalizedName(input: string) {
  return input.trim().toLowerCase().replace(/^\//, "").split(/[\s:]/, 1)[0] ?? "";
}

export function resolveCommandMetadata(input: string, options: { includePlanned?: boolean } = {}) {
  const command = commandNames.get(normalizedName(input));
  return command && (options.includePlanned !== false || !command.planned) ? command : undefined;
}

export function resolvePrefixCommandMetadata(input: string) {
  const name = normalizedName(input);
  return currentCommandRegistry.find((command) => command.aliases.includes(name));
}

export function getCommandMetadata(name: CommandName) {
  return canonicalCommands.get(name)!;
}

export function commandsByCategory(category: CommandCategory, includePlanned = false) {
  return commandRegistry.filter((command) => command.category === category && (includePlanned || !isPlanned(command)));
}

export function formatPrefixUsage(command: CommandMetadata, prefix: string) {
  return command.prefixUsage.map((usage) => `${prefix}${usage}`);
}

export function formatCommandExample(example: string, prefix: string) {
  return example.replaceAll("{prefix}", prefix);
}
