<script>
  let { loginHref, onLaunch } = $props()
</script>

<svelte:head>
  <title>Inochi — leveling that keeps up</title>
  <meta name="description" content="A fast, thoughtful Discord leveling system for communities that want activity to feel like play." />
</svelte:head>

<div class="landing">
  <nav class="landing-nav" aria-label="Main navigation">
    <a class="brand" href="/" aria-label="Inochi home"><span class="brand-mark" aria-hidden="true">+</span> inochi</a>
    <div class="landing-links">
      <a href="#signal">How it works</a>
      <a href="#features">Features</a>
      <a class="button button-small button-ghost" href={loginHref}>Log in</a>
    </div>
  </nav>

  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow"><span class="live-dot" aria-hidden="true"></span> built for busy communities</div>
        <h1 id="hero-title">Make every message<br /><em>count.</em></h1>
        <p class="hero-lede">Inochi turns conversation into momentum. A calm, fast leveling system with fair rewards, beautiful rank cards, and the headroom to grow with your server.</p>
        <div class="hero-actions">
          <a class="button button-primary" href={loginHref}>Add to Discord <span aria-hidden="true">↗</span></a>
          <button class="button button-ghost" onclick={onLaunch}>Open dashboard <span aria-hidden="true">→</span></button>
        </div>
        <div class="trust-row"><span>Rust core</span><i></i><span>PostgreSQL source of truth</span><i></i><span>Discord-native</span></div>
      </div>

      <div class="pulse-stage" aria-label="Animated activity signal">
        <div class="pulse-grid"></div>
        <div class="pulse-orbit orbit-one"></div>
        <div class="pulse-orbit orbit-two"></div>
        <div class="pulse-core"><span class="core-cross">+</span><span class="core-label">LIVE<br />ACTIVITY</span></div>
        <div class="signal-chip chip-top"><span class="chip-dot"></span> +25 XP <small>just now</small></div>
        <div class="signal-chip chip-bottom"><span class="chip-bars"><b></b><b></b><b></b><b></b></span> level 24 <small>community pulse</small></div>
        <div class="stage-caption"><span>01</span> the conversation is the game</div>
      </div>
    </section>

    <section id="signal" class="signal-band">
      <div><span class="section-index">01 / 03</span><h2>Quiet infrastructure.<br /><strong>Visible energy.</strong></h2></div>
      <p>Fast paths stay in memory. Durable progress stays in Postgres. Your members only see the fun part: a community that feels alive.</p>
    </section>

    <section id="features" class="feature-grid" aria-label="Product features">
      <article><span class="feature-number">01</span><h3>Leveling without noise</h3><p>Cooldowns, curves, multipliers, roles, weekly resets, and fair leaderboards—tuned for the way your server actually talks.</p><span class="feature-arrow">↗</span></article>
      <article><span class="feature-number">02</span><h3>Games made for chat</h3><p>Math cards, visual word rounds, timed challenges, and quick rewards turn dead air into something people want to return to.</p><span class="feature-arrow">↗</span></article>
      <article><span class="feature-number">03</span><h3>Ready when you are</h3><p>A monochrome dashboard for settings, audit history, rewards, API keys, and a health view that tells the truth.</p><span class="feature-arrow">↗</span></article>
    </section>
  </main>

  <footer><span>inochi / 2026</span><span>made for communities in motion</span><a href={loginHref}>get started ↗</a></footer>
</div>
