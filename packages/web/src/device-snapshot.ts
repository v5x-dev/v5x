import type {
  ISmartDeviceInfo,
  MatchMode,
  V5SerialDeviceState,
} from "@v5x/serial";

export interface V5DeviceSnapshot {
  matchMode: MatchMode;
  isFieldControllerConnected: boolean;
  brain: {
    activeProgram: number;
    battery: {
      batteryPercent: number;
      isCharging: boolean;
    };
    button: {
      isPressed: boolean;
      isDoublePressed: boolean;
    };
    cpu0Version: string;
    cpu1Version: string;
    isAvailable: boolean;
    settings: {
      isScreenReversed: boolean;
      isWhiteTheme: boolean;
      usingLanguage: number;
    };
    systemVersion: string;
    uniqueId: number;
  };
  controllers: [
    {
      battery: number;
      isAvailable: boolean;
      isCharging: boolean;
    },
    {
      battery: number;
      isAvailable: boolean;
      isCharging: boolean | undefined;
    },
  ];
  radio: {
    channel: number;
    isAvailable: boolean;
    isConnected: boolean;
    isRadioData: boolean;
    isVexNet: boolean;
    latency: number;
    signalQuality: number;
    signalStrength: number;
  };
  devices: ISmartDeviceInfo[];
}

export type V5ReadableDeviceState = Pick<
  V5SerialDeviceState,
  "brain" | "controllers" | "devices" | "radio" | "matchMode"
> & {
  isFieldControllerConnected: boolean;
};

export function createDeviceSnapshot(
  state: V5ReadableDeviceState | undefined,
  previous: V5DeviceSnapshot | null = null,
): V5DeviceSnapshot | null {
  if (state === undefined) return null;
  const snapshot: V5DeviceSnapshot = {
    matchMode: state.matchMode,
    isFieldControllerConnected: state.isFieldControllerConnected,
    brain: {
      activeProgram: state.brain.activeProgram,
      battery: {
        batteryPercent: state.brain.battery.batteryPercent,
        isCharging: state.brain.battery.isCharging,
      },
      button: {
        isPressed: state.brain.button.isPressed,
        isDoublePressed: state.brain.button.isDoublePressed,
      },
      cpu0Version: state.brain.cpu0Version.toInternalString(),
      cpu1Version: state.brain.cpu1Version.toInternalString(),
      isAvailable: state.brain.isAvailable,
      settings: {
        isScreenReversed: state.brain.settings.isScreenReversed,
        isWhiteTheme: state.brain.settings.isWhiteTheme,
        usingLanguage: state.brain.settings.usingLanguage,
      },
      systemVersion: state.brain.systemVersion.toInternalString(),
      uniqueId: state.brain.uniqueId,
    },
    controllers: [
      {
        battery: state.controllers[0]?.battery ?? 0,
        isAvailable: state.controllers[0]?.isAvailable ?? false,
        isCharging: state.controllers[0]?.isCharging ?? false,
      },
      {
        battery: state.controllers[1]?.battery ?? 0,
        isAvailable: state.controllers[1]?.isAvailable ?? false,
        isCharging: state.controllers[1]?.isCharging,
      },
    ],
    radio: {
      channel: state.radio.channel,
      isAvailable: state.radio.isAvailable,
      isConnected: state.radio.isConnected,
      isRadioData: state.radio.isRadioData,
      isVexNet: state.radio.isVexNet,
      latency: state.radio.latency,
      signalQuality: state.radio.signalQuality,
      signalStrength: state.radio.signalStrength,
    },
    devices: state.devices.filter((device) => device !== undefined),
  };
  if (previous === null) return snapshot;

  if (sameBrainSnapshot(previous.brain, snapshot.brain)) {
    snapshot.brain = previous.brain;
  }
  if (
    sameControllerSnapshot(previous.controllers[0], snapshot.controllers[0])
  ) {
    snapshot.controllers[0] = previous.controllers[0];
  }
  if (
    sameControllerSnapshot(previous.controllers[1], snapshot.controllers[1])
  ) {
    snapshot.controllers[1] = previous.controllers[1];
  }
  if (sameRadioSnapshot(previous.radio, snapshot.radio)) {
    snapshot.radio = previous.radio;
  }
  if (sameSmartDeviceList(previous.devices, snapshot.devices)) {
    snapshot.devices = previous.devices;
  }

  return previous.matchMode === snapshot.matchMode &&
    previous.isFieldControllerConnected ===
      snapshot.isFieldControllerConnected &&
    previous.brain === snapshot.brain &&
    previous.controllers[0] === snapshot.controllers[0] &&
    previous.controllers[1] === snapshot.controllers[1] &&
    previous.radio === snapshot.radio &&
    previous.devices === snapshot.devices
    ? previous
    : snapshot;
}

function sameBrainSnapshot(
  left: V5DeviceSnapshot["brain"],
  right: V5DeviceSnapshot["brain"],
): boolean {
  return (
    left.activeProgram === right.activeProgram &&
    left.battery.batteryPercent === right.battery.batteryPercent &&
    left.battery.isCharging === right.battery.isCharging &&
    left.button.isPressed === right.button.isPressed &&
    left.button.isDoublePressed === right.button.isDoublePressed &&
    left.cpu0Version === right.cpu0Version &&
    left.cpu1Version === right.cpu1Version &&
    left.isAvailable === right.isAvailable &&
    left.settings.isScreenReversed === right.settings.isScreenReversed &&
    left.settings.isWhiteTheme === right.settings.isWhiteTheme &&
    left.settings.usingLanguage === right.settings.usingLanguage &&
    left.systemVersion === right.systemVersion &&
    left.uniqueId === right.uniqueId
  );
}

function sameControllerSnapshot(
  left: V5DeviceSnapshot["controllers"][number],
  right: V5DeviceSnapshot["controllers"][number],
): boolean {
  return (
    left.battery === right.battery &&
    left.isAvailable === right.isAvailable &&
    left.isCharging === right.isCharging
  );
}

function sameRadioSnapshot(
  left: V5DeviceSnapshot["radio"],
  right: V5DeviceSnapshot["radio"],
): boolean {
  return (
    left.channel === right.channel &&
    left.isAvailable === right.isAvailable &&
    left.isConnected === right.isConnected &&
    left.isRadioData === right.isRadioData &&
    left.isVexNet === right.isVexNet &&
    left.latency === right.latency &&
    left.signalQuality === right.signalQuality &&
    left.signalStrength === right.signalStrength
  );
}

function sameSmartDeviceList(
  left: ISmartDeviceInfo[],
  right: ISmartDeviceInfo[],
): boolean {
  return (
    left.length === right.length &&
    left.every((device, index) => sameSmartDevice(device, right[index]!))
  );
}

function sameSmartDevice(
  left: ISmartDeviceInfo,
  right: ISmartDeviceInfo,
): boolean {
  return (
    left.port === right.port &&
    left.type === right.type &&
    left.status === right.status &&
    left.betaversion === right.betaversion &&
    left.version === right.version &&
    left.bootversion === right.bootversion
  );
}
