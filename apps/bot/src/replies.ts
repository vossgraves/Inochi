import { ContainerBuilder, SeparatorBuilder, TextDisplayBuilder } from "@discordjs/builders";
// SeparatorSpacingSize is re-exported by discord.js, not by @discordjs/builders.
import { MessageFlags, SeparatorSpacingSize } from "discord.js";
import { ERROR_RED, INFO_MUTED, INOCHI_VERMILION, SUCCESS_MOSS, WARNING_KINCHA } from "./theme";

/*
  The bot used `throw new Error("Choose another member")` as its messaging
  mechanism, and the interaction handler rendered every one of those as
  "**Error:** Choose another member". Roughly a hundred throw sites were
  ordinary guidance, so the product told people they had caused an error
  whenever they picked the wrong option.

  UserNotice separates the two cases:
    - A notice is expected, actionable, and the reader's to resolve. It is
      rendered plainly, with no "Error" wording and no reference code.
    - Anything else is a genuine fault. The reader gets "Something went wrong"
      and a reference; the detail goes to the logs and never to Discord, since
      an internal message can leak schema or infrastructure detail.
*/
export class UserNotice extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly tone: NoticeTone = "info",
  ) {
    super(message);
    this.name = "UserNotice";
  }
}

export type NoticeTone = "info" | "success" | "warning" | "blocked";

/** Throwable guidance. Reads as `throw notice("...")` at the call site. */
export function notice(message: string, hint?: string, tone: NoticeTone = "info") {
  return new UserNotice(message, hint, tone);
}

const toneColor: Record<NoticeTone, number> = {
  info: INFO_MUTED,
  success: SUCCESS_MOSS,
  warning: WARNING_KINCHA,
  blocked: INOCHI_VERMILION,
};

/**
 * A plain panel: the message, and an optional quieter line telling the reader
 * what to do next. No title, because a one-line notice does not need a heading
 * announcing that it is a notice.
 */
export function noticePanel(message: string, hint?: string, tone: NoticeTone = "info") {
  const container = new ContainerBuilder().setAccentColor(toneColor[tone]);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
  if (hint) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${hint}`));
  }
  return container;
}

/**
 * The genuine-failure panel. The reference is the only thing tying what the
 * reader sees to what the logs recorded, so it is always shown.
 */
export function failurePanel(reference: string) {
  return new ContainerBuilder()
    .setAccentColor(ERROR_RED)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Something went wrong on our side. Nothing was changed."),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Reference \`${reference}\``));
}

/*
  The general panel, replacing EmbedBuilder across the bot.

  An embed is a fixed shape: title, description, fields, colour. A container is
  a list of components, so a panel is composed rather than filled in. `body`
  entries are separated by a rule when `dividers` is set, which is what gives
  these more structure than the single markdown blob an embed forced.
*/
export function panel(
  title: string,
  body: string | string[],
  options: { color?: number; dividers?: boolean } = {},
) {
  const container = new ContainerBuilder().setAccentColor(options.color ?? INOCHI_VERMILION);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  const blocks = (Array.isArray(body) ? body : [body]).filter((block) => block.length > 0);
  for (const [index, block] of blocks.entries()) {
    if (options.dividers && index > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
  }
  return container;
}

/**
 * Renders label/value pairs as a definition list. Embeds laid these out in
 * columns via addFields; a container has no field concept, so they become
 * bolded labels with the value beneath.
 */
export function detailBlock(entries: Array<[string, string]>) {
  return entries.map(([label, value]) => `**${label}**\n${value}`).join("\n\n");
}

/** A Components V2 panel must not also carry `content`. */
export function panelPayload(container: ContainerBuilder, ephemeral = true) {
  return {
    components: [container],
    flags: ephemeral
      ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
      : MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] as never[] },
  };
}

/**
 * Plain-text form, for the prefix command path where a reply is a normal
 * message rather than an interaction response.
 */
export function noticeText(message: string, hint?: string) {
  return hint ? `${message}\n-# ${hint}` : message;
}
