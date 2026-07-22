import { redirect } from "next/navigation";
import { getOrCreateGuild } from "@inochi/database";
import { requireGuildManager } from "../../../../lib/auth";
import { SetupWizard } from "../../../../components/setup-wizard";

export default async function SetupPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildManager(guildId);
  if (!access) redirect("/dashboard");
  const row = await getOrCreateGuild((await import("@inochi/database")).db, guildId, access.guild.name);
  return <SetupWizard guildId={guildId} guildName={access.guild.name} initial={row.settings} revision={row.settingsRevision} />;
}
