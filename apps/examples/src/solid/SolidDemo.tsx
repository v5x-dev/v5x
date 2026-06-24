/** @jsxImportSource solid-js */
import { Show, createMemo, createSignal, onCleanup } from "solid-js";
import {
  V5Provider,
  createV5Connection,
  createV5Snapshot,
} from "@v5x/web/solid";
import {
  createFakeV5Environment,
  failureModes,
  type FailureMode,
  type FakeV5Controls,
} from "../fake-v5";

function createControlsSnapshot(controls: FakeV5Controls) {
  const [snapshot, setSnapshot] = createSignal({
    mode: controls.mode,
    stats: controls.stats,
  });
  const unsubscribe = controls.subscribe(() => {
    setSnapshot({ mode: controls.mode, stats: controls.stats });
  });

  onCleanup(unsubscribe);
  return snapshot;
}

function Panel(props: { controls: FakeV5Controls }) {
  const snapshot = createV5Snapshot();
  const connection = createV5Connection();
  const controls = createControlsSnapshot(props.controls);

  return (
    <article class="demo-card">
      <div class="demo-title">
        <h2>Solid</h2>
        <span class="badge" data-status={snapshot().status}>
          {snapshot().status}
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
            value={controls().mode}
            onChange={(event) =>
              props.controls.setMode(event.currentTarget.value as FailureMode)
            }
          >
            {failureModes.map((mode) => (
              <option value={mode}>{mode}</option>
            ))}
          </select>
        </label>
      </div>

      <div class="actions">
        <button
          class="button primary"
          type="button"
          disabled={!snapshot().supported || snapshot().connecting}
          onClick={() => void connection.connect()}
        >
          Connect
        </button>
        <button
          class="button"
          type="button"
          disabled={!snapshot().connected}
          onClick={() => void connection.refresh()}
        >
          Refresh
        </button>
        <button
          class="button"
          type="button"
          disabled={!snapshot().connected || snapshot().disconnecting}
          onClick={() => void connection.disconnect()}
        >
          Disconnect
        </button>
      </div>

      <dl class="snapshot">
        <div>
          <dt>Supported</dt>
          <dd>{String(snapshot().supported)}</dd>
        </div>
        <div>
          <dt>Unavailable</dt>
          <dd>{snapshot().unavailableReason ?? "none"}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{snapshot().error?.code ?? "none"}</dd>
        </div>
      </dl>

      <dl class="stats">
        <div>
          <dt>Connects</dt>
          <dd>{controls().stats.connects}</dd>
        </div>
        <div>
          <dt>Refreshes</dt>
          <dd>{controls().stats.refreshes}</dd>
        </div>
        <div>
          <dt>Disconnects</dt>
          <dd>{controls().stats.disconnects}</dd>
        </div>
      </dl>

      <p class="error-text">{snapshot().error?.message ?? ""}</p>
    </article>
  );
}

export function SolidDemo() {
  const [supported, setSupported] = createSignal(true);
  const environment = createMemo(() =>
    createFakeV5Environment({ supported: supported() }),
  );

  return (
    <Show keyed when={environment()}>
      {(currentEnvironment) => (
        <V5Provider client={currentEnvironment.client}>
          <Panel controls={currentEnvironment.controls} />
          <button
            class="button support-toggle"
            type="button"
            onClick={() => setSupported((value) => !value)}
          >
            Toggle support: {supported() ? "supported" : "unsupported"}
          </button>
        </V5Provider>
      )}
    </Show>
  );
}
