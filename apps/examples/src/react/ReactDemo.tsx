import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  V5Provider,
  useV5Connection,
  useV5Console,
  useV5Snapshot,
} from "@v5x/web/react";
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

      <Console connected={snapshot.connected} />

      <p className="error-text">{snapshot.error?.message ?? ""}</p>
    </article>
  );
}

function Console({ connected }: { connected: boolean }) {
  const console = useV5Console();
  const output = useRef<HTMLPreElement>(null);

  // Follow the tail on new output. `chunks` changes even when the buffer text
  // is unchanged after trimming, so it is the reliable trigger.
  useEffect(() => {
    const element = output.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [console.chunks]);

  return (
    <section className="console">
      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={!connected || console.streaming}
          onClick={() => void console.start()}
        >
          Start console
        </button>
        <button
          className="button"
          type="button"
          disabled={!console.streaming}
          onClick={() => void console.stop()}
        >
          Stop
        </button>
        <button
          className="button"
          type="button"
          onClick={() => console.clear()}
        >
          Clear
        </button>
      </div>
      <pre className="console-output" ref={output}>
        {console.text || "(no program output yet)"}
      </pre>
    </section>
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
