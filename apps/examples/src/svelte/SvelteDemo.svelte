<script lang="ts">
  import { createV5State } from "@v5x/web/svelte";
  import {
    createFakeV5Environment,
    failureModes,
    type FailureMode,
  } from "../fake-v5";

  let supported = $state(true);
  let environment = $derived(createFakeV5Environment({ supported }));
  let v5 = $derived(createV5State(environment.client));
  let controlsVersion = $state(0);

  $effect(() => environment.controls.subscribe(() => controlsVersion++));

  const controls = $derived.by(() => {
    void controlsVersion;
    const { mode, stats } = environment.controls;
    return { mode, stats };
  });
</script>

{#snippet row(term: string, detail: string | number)}
  <div>
    <dt>{term}</dt>
    <dd>{detail}</dd>
  </div>
{/snippet}

<article class="demo-card">
  <div class="demo-title">
    <h2>Svelte</h2>
    <span class="badge" data-status={v5.snapshot.status}>
      {v5.snapshot.status}
    </span>
  </div>

  <div class="control-grid">
    <label class="field">
      <span>Support</span>
      <select class="select" value="supported" disabled>
        <option>supported</option>
      </select>
    </label>
    <label class="field">
      <span>Failure</span>
      <select
        class="select"
        value={controls.mode}
        onchange={(event) =>
          environment.controls.setMode(event.currentTarget.value as FailureMode)}
      >
        {#each failureModes as mode}
          <option value={mode}>{mode}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="actions">
    <button
      class="button primary"
      type="button"
      disabled={!v5.snapshot.supported || v5.snapshot.connecting}
      onclick={() => v5.connect()}
    >
      Connect
    </button>
    <button
      class="button"
      type="button"
      disabled={!v5.snapshot.connected}
      onclick={() => v5.refresh()}
    >
      Refresh
    </button>
    <button
      class="button"
      type="button"
      disabled={!v5.snapshot.connected || v5.snapshot.disconnecting}
      onclick={() => v5.disconnect()}
    >
      Disconnect
    </button>
  </div>

  <dl class="snapshot">
    {@render row("Supported", String(v5.snapshot.supported))}
    {@render row("Unavailable", v5.snapshot.unavailableReason ?? "none")}
    {@render row("Error", v5.snapshot.error?.code ?? "none")}
  </dl>

  <dl class="stats">
    {@render row("Connects", controls.stats.connects)}
    {@render row("Refreshes", controls.stats.refreshes)}
    {@render row("Disconnects", controls.stats.disconnects)}
  </dl>

  <p class="error-text">{v5.snapshot.error?.message ?? ""}</p>
</article>

<button
  class="button support-toggle"
  type="button"
  onclick={() => (supported = !supported)}
>
  Toggle support: {supported ? "supported" : "unsupported"}
</button>
