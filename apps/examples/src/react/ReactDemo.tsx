import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { V5Provider, useV5Connection, useV5Snapshot } from "@v5x/web/react";
import {
  createFakeV5Environment,
  failureModes,
  type FailureMode,
  type FakeV5Controls,
} from "../fake-v5";

function useControls(controls: FakeV5Controls) {
  const subscribe = useCallback(
    (listener: () => void) => controls.subscribe(listener),
    [controls],
  );
  const mode = useSyncExternalStore(subscribe, () => controls.mode);
  const stats = useSyncExternalStore(subscribe, () => controls.stats);
  return { mode, stats };
}

function Row({ term, detail }: { term: string; detail: string | number }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}

function Panel({ controls }: { controls: FakeV5Controls }) {
  const snapshot = useV5Snapshot();
  const connection = useV5Connection();
  const { mode, stats } = useControls(controls);

  return (
    <article className="demo-card">
      <div className="demo-title">
        <h2>React</h2>
        <span className="badge" data-status={snapshot.status}>
          {snapshot.status}
        </span>
      </div>

      <div className="control-grid">
        <label className="field">
          <span>Support</span>
          <select className="select" value="supported" disabled>
            <option>supported</option>
          </select>
        </label>
        <label className="field">
          <span>Failure</span>
          <select
            className="select"
            value={mode}
            onChange={(event) =>
              controls.setMode(event.currentTarget.value as FailureMode)
            }
          >
            {failureModes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="actions">
        <button
          className="button primary"
          type="button"
          disabled={!snapshot.supported || snapshot.connecting}
          onClick={() => void connection.connect()}
        >
          Connect
        </button>
        <button
          className="button"
          type="button"
          disabled={!snapshot.connected}
          onClick={() => void connection.refresh()}
        >
          Refresh
        </button>
        <button
          className="button"
          type="button"
          disabled={!snapshot.connected || snapshot.disconnecting}
          onClick={() => void connection.disconnect()}
        >
          Disconnect
        </button>
      </div>

      <dl className="snapshot">
        <Row term="Supported" detail={String(snapshot.supported)} />
        <Row term="Unavailable" detail={snapshot.unavailableReason ?? "none"} />
        <Row term="Error" detail={snapshot.error?.code ?? "none"} />
      </dl>

      <dl className="stats">
        <Row term="Connects" detail={stats.connects} />
        <Row term="Refreshes" detail={stats.refreshes} />
        <Row term="Disconnects" detail={stats.disconnects} />
      </dl>

      <p className="error-text">{snapshot.error?.message ?? ""}</p>
    </article>
  );
}

export function ReactDemo() {
  const [supported, setSupported] = useState(true);
  const environment = useMemo(
    () => createFakeV5Environment({ supported }),
    [supported],
  );

  return (
    <V5Provider client={environment.client}>
      <Panel controls={environment.controls} />
      <button
        className="button support-toggle"
        type="button"
        onClick={() => setSupported((value) => !value)}
      >
        Toggle support: {supported ? "supported" : "unsupported"}
      </button>
    </V5Provider>
  );
}
