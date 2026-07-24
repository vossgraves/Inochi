import { MAX_COINFLIP_WAGER } from "@inochi/core";
import { importProviderIds, importProviders } from "@inochi/importers";
import { ApplicationCommandType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const manage = PermissionFlagsBits.ManageGuild;

export const commandDefinitions = [
  new SlashCommandBuilder().setName("rank").setDescription("View a member's rank card")
    .addUserOption((option) => option.setName("member").setDescription("Member to view"))
    .addBooleanOption((option) => option.setName("hidden").setDescription("Only show this to you"))
    .addBooleanOption((option) => option.setName("text_mode").setDescription("Show a lightweight text rank")),
  new SlashCommandBuilder().setName("top").setDescription("View the XP leaderboard")
    .addIntegerOption((option) => option.setName("page").setDescription("Leaderboard page").setMinValue(1))
    .addUserOption((option) => option.setName("member").setDescription("Highlight a member")),
  new SlashCommandBuilder().setName("weekly").setDescription("Configure or view weekly XP")
    .addStringOption((option) => option.setName("action").setDescription("Action").addChoices(
      { name: "Leaderboard", value: "show" }, { name: "Enable", value: "enable" }, { name: "Disable", value: "disable" }, { name: "Reset", value: "reset" },
    )),
  new SlashCommandBuilder().setName("winner").setDescription("Choose the top three weekly XP winners").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("joinrole").setDescription("Set the role granted when a member joins").setDefaultMemberPermissions(manage)
    .addRoleOption((option) => option.setName("role").setDescription("Leave empty to disable")),
  new SlashCommandBuilder().setName("blacklist").setDescription("Prevent roles from earning XP").setDefaultMemberPermissions(manage)
    .addStringOption((option) => option.setName("action").setDescription("Action").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }, { name: "Show", value: "show" }))
    .addRoleOption((option) => option.setName("role").setDescription("Role to add or remove")),
  new SlashCommandBuilder().setName("reset").setDescription("Reset one member's XP").setDefaultMemberPermissions(manage)
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("refresh").setDescription("Refresh rewards or clear all points").setDefaultMemberPermissions(manage)
    .addStringOption((option) => option.setName("scope").setDescription("Data to refresh").setRequired(true).addChoices({ name: "Reward roles", value: "roles" }, { name: "All points", value: "points" }))
    .addStringOption((option) => option.setName("confirmation").setDescription("Type RESET when clearing points")),
  new SlashCommandBuilder().setName("calculate").setDescription("Calculate progress to a level")
    .addIntegerOption((option) => option.setName("level").setDescription("Target level").setMinValue(1).setRequired(true))
    .addUserOption((option) => option.setName("member").setDescription("Member to calculate for")),
  new SlashCommandBuilder().setName("sync").setDescription("Synchronize level reward roles")
    .addUserOption((option) => option.setName("member").setDescription("Member to synchronize")),
  new SlashCommandBuilder().setName("addxp").setDescription("Modify a member's XP").setDefaultMemberPermissions(manage)
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addIntegerOption((option) => option.setName("amount").setDescription("Amount").setRequired(true))
    .addStringOption((option) => option.setName("operation").setDescription("Operation").addChoices(
      { name: "Add XP", value: "add_xp" }, { name: "Set XP", value: "set_xp" },
      { name: "Add levels", value: "add_levels" }, { name: "Set level", value: "set_level" },
    )),
  new SlashCommandBuilder().setName("clear").setDescription("Clear a member's XP cooldown").setDefaultMemberPermissions(manage)
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("config").setDescription("Open this server's dashboard").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("setup").setDescription("Open the guided server setup").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("rewardrole").setDescription("Configure a level reward role").setDefaultMemberPermissions(manage)
    .addRoleOption((option) => option.setName("role").setDescription("Reward role").setRequired(true))
    .addIntegerOption((option) => option.setName("level").setDescription("Level, or 0 to remove").setMinValue(0).setRequired(true))
    .addBooleanOption((option) => option.setName("keep").setDescription("Keep lower reward roles"))
    .addBooleanOption((option) => option.setName("dont_sync").setDescription("Do not synchronize automatically")),
  new SlashCommandBuilder().setName("multiplier").setDescription("Configure XP multipliers").setDefaultMemberPermissions(manage)
    .addSubcommand((command) => command.setName("role").setDescription("Set a role multiplier")
      .addRoleOption((option) => option.setName("role").setDescription("Role").setRequired(true))
      .addNumberOption((option) => option.setName("value").setDescription("0 removes; up to 100x").setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand((command) => command.setName("channel").setDescription("Set a channel multiplier")
      .addChannelOption((option) => option.setName("channel").setDescription("Channel").setRequired(true))
      .addNumberOption((option) => option.setName("value").setDescription("0 removes; up to 100x").setMinValue(0).setMaxValue(100).setRequired(true))),
  new SlashCommandBuilder().setName("botstatus").setDescription("Show bot status"),
  new SlashCommandBuilder().setName("word").setDescription("Start a word race now").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("maths").setDescription("Start a maths race now").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("coinflip").setDescription("Challenge another member to an XP coinflip")
    .addUserOption((option) => option.setName("opponent").setDescription("Member to challenge").setRequired(true))
    .addIntegerOption((option) => option.setName("wager").setDescription("XP wagered by each player").setMinValue(1).setMaxValue(MAX_COINFLIP_WAGER).setRequired(true))
    .addStringOption((option) => option.setName("side").setDescription("Your side").setRequired(true).addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })),
  new SlashCommandBuilder().setName("vote").setDescription("Vote for Inochi and check your XP boost"),
  new SlashCommandBuilder().setName("xpchannel").setDescription("Configure where chat XP is earned").setDefaultMemberPermissions(manage)
    .addSubcommand((command) => command.setName("mode").setDescription("Set allowlist or denylist mode")
      .addStringOption((option) => option.setName("value").setDescription("Policy mode").setRequired(true).addChoices({ name: "Denylist", value: "denylist" }, { name: "Allowlist", value: "allowlist" })))
    .addSubcommand((command) => command.setName("add").setDescription("Add a channel, category, forum, or thread")
      .addChannelOption((option) => option.setName("channel").setDescription("Location").setRequired(true)))
    .addSubcommand((command) => command.setName("remove").setDescription("Remove a location")
      .addChannelOption((option) => option.setName("channel").setDescription("Location").setRequired(true)))
    .addSubcommand((command) => command.setName("list").setDescription("List the current policy"))
    .addSubcommand((command) => command.setName("threads").setDescription("Toggle XP inside eligible threads")
      .addBooleanOption((option) => option.setName("enabled").setDescription("Allow thread XP").setRequired(true))),
  new SlashCommandBuilder().setName("privacy").setDescription("Anonymize yourself on public leaderboards")
    .addBooleanOption((option) => option.setName("leaderboard").setDescription("Hide on public leaderboards")),
  new SlashCommandBuilder().setName("colour").setDescription("Set your rank-card progress colour")
    .addStringOption((option) => option.setName("colour").setDescription("Hex colour; omit to reset")),
  new SlashCommandBuilder().setName("background").setDescription("Manage your rank-card background")
    .addSubcommand((command) => command.setName("set").setDescription("Upload a background").addAttachmentOption((option) => option.setName("image").setDescription("PNG, JPEG, GIF, or WebP under 5 MB").setRequired(true)))
    .addSubcommand((command) => command.setName("view").setDescription("View your current background"))
    .addSubcommand((command) => command.setName("delete").setDescription("Delete your background")),
  new SlashCommandBuilder().setName("wrapped").setDescription("View your Inochi activity summary"),
  new SlashCommandBuilder().setName("help").setDescription("View Inochi commands")
    .addStringOption((option) => option.setName("command").setDescription("Command name or alias")),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Manage the persistent leaderboard").setDefaultMemberPermissions(manage)
    .addSubcommand((command) => command.setName("setup").setDescription("Create or move the persistent leaderboard")
      .addChannelOption((option) => option.setName("channel").setDescription("Leaderboard channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addIntegerOption((option) => option.setName("rows").setDescription("Number of members to show").setMinValue(5).setMaxValue(25)))
    .addSubcommand((command) => command.setName("status").setDescription("Show persistent leaderboard status"))
    .addSubcommand((command) => command.setName("refresh").setDescription("Refresh the persistent leaderboard now"))
    .addSubcommand((command) => command.setName("disable").setDescription("Remove the persistent leaderboard")),
  new SlashCommandBuilder().setName("diagnose").setDescription("Check Inochi configuration and permissions").setDefaultMemberPermissions(manage),
  new SlashCommandBuilder().setName("import").setDescription("Import XP and compatible progression settings").setDefaultMemberPermissions(manage)
    .addStringOption((option) => option.setName("source").setDescription("Source bot (or choose in the panel)").addChoices(
      ...importProviderIds.map((value) => ({ name: importProviders[value].label, value })),
    )),
  { name: "Check XP", type: ApplicationCommandType.User },
  { name: "View on leaderboard", type: ApplicationCommandType.User },
].map((command) => "toJSON" in command ? command.toJSON() : command);
