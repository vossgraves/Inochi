# UI, lifecycle, and scale audit

**Reviewed 2026-09-05.**

## Memory-leak review

### Backend

- Settings cache: bounded at 20,000 entries, removes stale entries before insert, and invalidates on bot-side settings writes.
- Cooldown cache: bounded at 100,000 entries and pruned on growth.
- Game maps: expired rounds are removed on insert and capped at 50,000 Q&A plus 50,000 highest-number rounds.
- Highest-number timers: one bounded 90-second task is created per active round. This is intentionally ephemeral; if concurrent rounds ever approach the cap, move round expiry to one shared scheduler or Redis sorted-set rather than increasing the cap.
- PostgreSQL pool: fixed small pool per process; XP is not kept as process-local state.
- Discord gateway: bot now uses Serenity autosharding, which asks Discord for the recommended shard count instead of remaining on one connection.

### Dashboard

- The only component lifecycle fetch that existed on app mount now uses `AbortController`; it is cancelled when the app unmounts.
- Removed a duplicate `onMount(loadAll())` in `ApiKeys.svelte`; that component already loaded through `$effect` and was making two initial request batches.
- No timers, event listeners, manual subscriptions, observers, sockets, or global stores exist in the dashboard code.
- Fetch promises in feature panels are short-lived and resolve into local component state. A next hardening step is passing per-effect abort signals to every panel if navigation becomes route-based.

## UI direction

The dashboard and public surface now share a restrained monochrome token system:

- near-black canvas, zinc surfaces, hairline borders;
- compact 6px controls and keyboard-visible focus rings;
- high-contrast primary CTA and quiet secondary actions;
- system sans for UI and monospace only for technical labels/data;
- responsive table overflow, compact mobile navigation, reduced-motion support;
- empty, loading, error, disabled, and success states retained in existing panels.

The primitives are dependency-free Svelte equivalents of the useful parts of Vercel Geist, 21st.dev Geist examples, and Kokonut/shadcn motion patterns. React-only packages were not forced into this Svelte app merely to claim a dependency; the interaction and visual rules are implemented locally so bundle size stays small.

## Landing motion

A real Remotion composition would require a React/video rendering pipeline that does not belong in this Svelte dashboard bundle. The landing page therefore uses a close-up pulse scene implemented in CSS: concentric orbit rings, a breathing activity core, signal chips, and a grid. Only `transform`, `opacity`, and `box-shadow` animate, and `prefers-reduced-motion` disables the effects. This is cheaper than autoplay video and degrades cleanly on low-end devices.

The hero communicates the actual product value rather than showing an unrelated stock animation: messages create activity, activity creates XP, and the dashboard exposes the durable state.

## Research references

- Geist foundations and components: https://vercel.com/geist/introduction and https://vercel.com/geist/button
- 21st.dev Geist collection: https://21st.dev/@shugar/library/geist
- Kokonut UI patterns: https://aestheta.ai/kokonut-ui/
- Svelte effect cleanup guidance: https://svelte.dev/docs/svelte/$effect
- Discord gateway/autosharding: https://discord.com/developers/docs/topics/gateway
- Pulse animation and reduced-motion guidance: https://codefronts.com/motion/css-pulse-animation/
- Motion/product-preview guidance: https://spell.sh/blog/hero-section-best-practices

## Verification

`npm run build` passes after the UI work. The Vite server was also tested through the Arena preview host after adding `server.allowedHosts: true`. Rust verification remains blocked by the environment not having `cargo`/`rustc` installed.
