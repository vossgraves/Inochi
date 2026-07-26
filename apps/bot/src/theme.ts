/*
  Discord embed and container accent colours, matching the Ink and Vermilion
  tokens in apps/web/app/globals.css so an embed in chat and the dashboard read
  as the same product.

  Names changed along with the values, because a constant called INOCHI_VIOLET
  holding a red would be a lie. INOCHI_VERMILION takes over the default-accent
  role that INOCHI_NAVY used to hold.

  A Discord accent colour renders as a narrow stripe beside the message, so the
  near-black background token is deliberately absent here: #14110f would be
  invisible against Discord's dark theme.
*/
export const INOCHI_VERMILION = 0xd9401f;
export const INFO_MUTED = 0xa8a199;
export const SUCCESS_MOSS = 0x4f7c4a;
export const ERROR_RED = 0xb3261e;
export const WARNING_KINCHA = 0xc98a2b;
