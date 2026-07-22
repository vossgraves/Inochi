const invitePermissions = {
  viewChannels: 1n << 10n,
  sendMessages: 1n << 11n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readMessageHistory: 1n << 16n,
  useExternalEmojis: 1n << 18n,
  manageRoles: 1n << 28n,
  sendMessagesInThreads: 1n << 38n,
};

export const discordInvitePermissions = Object.values(invitePermissions).reduce((permissions, flag) => permissions | flag, 0n);

export function buildDiscordInviteUrl(clientId: string) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: discordInvitePermissions.toString(),
    integration_type: "0",
  }).toString();
  return url;
}
