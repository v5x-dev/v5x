import { createElement, useMemo, useSyncExternalStore, useState } from "react";
import { V5Provider, useV5Connection, useV5Snapshot } from "@v5x/web/react";
import {
  createFakeV5Environment,
  failureModes,
  type FailureMode,
  type FakeV5Controls,
} from "../fake-v5";

const h = createElement;

function useControlsSnapshot(controls: FakeV5Controls) {
  const getSnapshot = useMemo(() => {
    let snapshot = { mode: controls.mode, stats: controls.stats };

    return () => {
      const stats = controls.stats;
      if (
        snapshot.mode === controls.mode &&
        snapshot.stats.connects === stats.connects &&
        snapshot.stats.refreshes === stats.refreshes &&
        snapshot.stats.disconnects === stats.disconnects &&
        snapshot.stats.disposed === stats.disposed
      ) {
        return snapshot;
      }

      snapshot = { mode: controls.mode, stats };
      return snapshot;
    };
  }, [controls]);

  return useSyncExternalStore(
    (listener) => controls.subscribe(listener),
    getSnapshot,
    getSnapshot,
  );
}

function row(term: string, detail: string | number) {
  return h("div", null, h("dt", null, term), h("dd", null, detail));
}

function Panel({ controls }: { controls: FakeV5Controls }) {
  const snapshot = useV5Snapshot();
  const connection = useV5Connection();
  const controlSnapshot = useControlsSnapshot(controls);

  return h(
    "article",
    { className: "demo-card" },
    h(
      "div",
      { className: "demo-title" },
      h("h2", null, "React"),
      h(
        "span",
        { className: "badge", "data-status": snapshot.status },
        snapshot.status,
      ),
    ),
    h(
      "div",
      { className: "control-grid" },
      h(
        "label",
        { className: "field" },
        h("span", null, "Support"),
        h(
          "select",
          { className: "select", value: "supported", disabled: true },
          h("option", null, "supported"),
        ),
      ),
      h(
        "label",
        { className: "field" },
        h("span", null, "Failure"),
        h(
          "select",
          {
            className: "select",
            value: controlSnapshot.mode,
            onChange: (event) => {
              const select = event.currentTarget as HTMLSelectElement;
              controls.setMode(select.value as FailureMode);
            },
          },
          failureModes.map((mode) =>
            h("option", { key: mode, value: mode }, mode),
          ),
        ),
      ),
    ),
    h(
      "div",
      { className: "actions" },
      h(
        "button",
        {
          className: "button primary",
          type: "button",
          disabled: !snapshot.supported || snapshot.connecting,
          onClick: () => void connection.connect(),
        },
        "Connect",
      ),
      h(
        "button",
        {
          className: "button",
          type: "button",
          disabled: !snapshot.connected,
          onClick: () => void connection.refresh(),
        },
        "Refresh",
      ),
      h(
        "button",
        {
          className: "button",
          type: "button",
          disabled: !snapshot.connected || snapshot.disconnecting,
          onClick: () => void connection.disconnect(),
        },
        "Disconnect",
      ),
    ),
    h(
      "dl",
      { className: "snapshot" },
      row("Supported", String(snapshot.supported)),
      row("Unavailable", snapshot.unavailableReason ?? "none"),
      row("Error", snapshot.error?.code ?? "none"),
    ),
    h(
      "dl",
      { className: "stats" },
      row("Connects", controlSnapshot.stats.connects),
      row("Refreshes", controlSnapshot.stats.refreshes),
      row("Disconnects", controlSnapshot.stats.disconnects),
    ),
    h("p", { className: "error-text" }, snapshot.error?.message ?? ""),
  );
}

export function ReactDemo() {
  const [supported, setSupported] = useState(true);
  const environment = useMemo(
    () => createFakeV5Environment({ supported }),
    [supported],
  );

  return h(
    V5Provider,
    {
      client: environment.client,
      children: [
        h(Panel, { key: "panel", controls: environment.controls }),
        h(
          "button",
          {
            key: "support-toggle",
            className: "button support-toggle",
            type: "button",
            onClick: () => setSupported((value) => !value),
          },
          `Toggle support: ${supported ? "supported" : "unsupported"}`,
        ),
      ],
    },
  );
}
