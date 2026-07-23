import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { MessageFlags } from "discord.js";
import { INOCHI_NAVY } from "../theme";
import {
  commandsByCategory,
  formatCommandExample,
  formatPrefixUsage,
  resolveCommandMetadata,
  resolvePrefixCommandMetadata,
  type CommandMetadata,
} from "./metadata";

export const INOCHI_HELP_INTRO = "Inochi is a self-hosted Discord leveling bot and dashboard. It is a full TypeScript rewrite of Polaris with PostgreSQL, a monochrome Next.js dashboard, atomic XP updates, image chat games, rank cards, voting boosts, backups, and migration tools.";
export const DEFAULT_APP_URL = "http://localhost:3000";
export const DEFAULT_SUPPORT_URL = "https://github.com/vossgraves/Inochi/issues";

export interface HelpLinks {
  readonly appUrl?: string;
  readonly supportUrl?: string;
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function commandHelpLinks(links: HelpLinks = {}) {
  const appUrl = withoutTrailingSlash(links.appUrl ?? process.env.APP_URL ?? DEFAULT_APP_URL);
  const supportUrl = withoutTrailingSlash(links.supportUrl ?? process.env.SUPPORT_URL ?? DEFAULT_SUPPORT_URL);
  return { commands: `${appUrl}/commands`, support: supportUrl };
}

function commandLines(category: "member" | "admin") {
  return commandsByCategory(category).map((command) => `\`/${command.name}\``).join("\n");
}

export function renderCommandOverview(prefix: string, links: HelpLinks = {}) {
  const urls = commandHelpLinks(links);
  return [
    "## Inochi commands",
    INOCHI_HELP_INTRO,
    "",
    "### Member commands",
    commandLines("member"),
    "",
    "### Administrator commands",
    commandLines("admin"),
    "",
    `Prefix commands use \`${prefix}\`. For detailed usage, aliases, and examples, visit [all commands](${urls.commands}) or [get support](${urls.support}).`,
  ].join("\n");
}

export function commandOverviewComponents(prefix: string, links: HelpLinks = {}) {
  return {
    components: [new ContainerBuilder().setAccentColor(INOCHI_NAVY).addTextDisplayComponents(new TextDisplayBuilder().setContent(renderCommandOverview(prefix, links)))],
    flags: MessageFlags.IsComponentsV2 as const,
  };
}

function optionLine(option: CommandMetadata["options"][number]) {
  const requirement = option.required ? "required" : "optional";
  const choices = option.choices?.length ? ` Choices: ${option.choices.map((choice) => `\`${choice}\``).join(", ")}.` : "";
  return `- \`${option.name}\` (${option.type}, ${requirement}): ${option.description}${choices}`;
}

export function renderCommandDetail(command: CommandMetadata, prefix: string) {
  const aliases = command.aliases.filter((alias) => alias !== command.name);
  const sections = [
    `## /${command.name}${command.planned ? " (planned)" : ""}`,
    command.description,
    "",
    `**Category:** ${command.category === "admin" ? "Administrator" : "Member"}`,
    `**Permission:** ${command.permission}`,
    `**Aliases:** ${aliases.length ? aliases.map((alias) => `\`${alias}\``).join(", ") : "None"}`,
    "",
    "### Slash usage",
    command.slashUsage.map((usage) => `\`${usage}\``).join("\n"),
    "",
    "### Prefix usage",
    formatPrefixUsage(command, prefix).map((usage) => `\`${usage}\``).join("\n"),
  ];

  if (command.options.length) sections.push("", "### Options", command.options.map(optionLine).join("\n"));
  if (command.subcommands.length) {
    sections.push("", "### Subcommands", command.subcommands.map((subcommand) => {
      const options = subcommand.options.length ? `\n${subcommand.options.map(optionLine).join("\n")}` : "";
      return `**\`${subcommand.name}\`**: ${subcommand.description}${options}`;
    }).join("\n\n"));
  }
  sections.push("", "### Examples", command.examples.map((example) => `\`${formatCommandExample(example, prefix)}\``).join("\n"));
  return sections.join("\n");
}

export function resolveCommandHelp(input: string, prefix: string, source: "slash" | "prefix" = "slash") {
  const command = source === "prefix" ? resolvePrefixCommandMetadata(input) : resolveCommandMetadata(input);
  return command ? renderCommandDetail(command, prefix) : undefined;
}

export function commandDetailComponents(input: string, prefix: string, source: "slash" | "prefix" = "slash") {
  const content = resolveCommandHelp(input, prefix, source);
  if (!content) return undefined;
  return {
    components: [new ContainerBuilder().setAccentColor(INOCHI_NAVY).addTextDisplayComponents(new TextDisplayBuilder().setContent(content))],
    flags: MessageFlags.IsComponentsV2 as const,
  };
}
