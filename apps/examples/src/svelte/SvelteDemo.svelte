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

  $effect(() => {
    const unsubscribe = environment.controls.subscribe(() => {
      controlsVersion += 1;
    });

    return unsubscribe;
  });

  const controls = $derived.by(() => {
    controlsVersion;
    return {
      mode: environment.controls.mode,
      stats: environment.controls.stats,
    };
  });

  function setMode(value: string): void {
    environment.controls.setMode(value as FailureMode);
  }
</script>

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
        onchange={(event) => setMode(event.currentTarget.value)}
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
    <div>
      <dt>Supported</dt>
      <dd>{String(v5.snapshot.supported)}</dd>
    </div>
    <div>
      <dt>Unavailable</dt>
      <dd>{v5.snapshot.unavailableReason ?? "none"}</dd>
    </div>
    <div>
      <dt>Error</dt>
      <dd>{v5.snapshot.error?.code ?? "none"}</dd>
    </div>
  </dl>

  <dl class="stats">
    <div>
      <dt>Connects</dt>
      <dd>{controls.stats.connects}</dd>
    </div>
    <div>
      <dt>Refreshes</dt>
      <dd>{controls.stats.refreshes}</dd>
    </div>
    <div>
      <dt>Disconnects</dt>
      <dd>{controls.stats.disconnects}</dd>
    </div>
  </dl>

  <p class="error-text">{v5.snapshot.error?.message ?? ""}</p>
</article>

<button
  class="button support-toggle"
  type="button"
  onclick={() => {
    supported = !supported;
  }}
>
  Toggle support: {supported ? "supported" : "unsupported"}
</button>
