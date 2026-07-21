import type { GuildSettings } from "./settings";

export interface MultiplierContext {
  roleIds: string[];
  channelIds: string[];
}

function roleMultiplier(values: number[], mode: GuildSettings["multipliers"]["roleMode"]): number {
  if (values.some((value) => value <= 0)) return 0;
  if (!values.length) return 1;
  if (mode === "highest") return values[0] ?? 1;
  if (mode === "smallest") return Math.min(...values);
  if (mode === "add") return Math.max(0, 1 + values.reduce((total, value) => total + value - 1, 0));
  if (mode === "combine") return Math.min(1_000_000, values.reduce((total, value) => total * value, 1));
  return Math.max(...values);
}

export function calculateMultiplier(settings: GuildSettings, context: MultiplierContext): number {
  const roleValues = context.roleIds.flatMap((id) => {
    const found = settings.multipliers.roles.find((item) => item.roleId === id);
    return found ? [found.multiplier] : [];
  });
  const channelValue = context.channelIds.flatMap((id) => {
    const found = settings.multipliers.channels.find((item) => item.channelId === id);
    return found ? [found.multiplier] : [];
  })[0] ?? 1;
  const roleValue = roleMultiplier(roleValues, settings.multipliers.roleMode);
  if (roleValue <= 0 || channelValue <= 0) return 0;
  const mode = settings.multipliers.stackMode;
  const result = mode === "add" ? 1 + (roleValue - 1) + (channelValue - 1)
    : mode === "largest" ? Math.max(roleValue, channelValue)
    : mode === "channel" ? channelValue
    : mode === "role" ? roleValue
    : roleValue * channelValue;
  return Number(result.toFixed(4));
}
