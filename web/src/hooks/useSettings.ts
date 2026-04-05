import { useState, useCallback } from 'react';

export interface DroneMedicSettings {
  profile: {
    displayName: string;
    email: string;
    role: 'Pilot' | 'Dispatcher' | 'Admin';
  };
  notifications: {
    enabled: boolean;
    sound: boolean;
    missionComplete: boolean;
    lowBattery: boolean;
    noFlyBreach: boolean;
    weatherWarning: boolean;
  };
  drone: {
    defaultAltitude: number;
    maxSpeed: number;
    batteryLowThreshold: number;
    batteryCriticalThreshold: number;
    maxPayload: number;
    returnOnLowBattery: boolean;
    autoAvoidNoFly: boolean;
    enableRerouting: boolean;
  };
  map: {
    defaultTileLayer: 'Dark' | 'Satellite' | 'Street' | 'Topographic';
    units: 'metric' | 'imperial';
    showNoFlyZones: boolean;
    showWeatherOverlay: boolean;
    showDroneTrail: boolean;
  };
  display: {
    hudPosition: 'Right' | 'Left';
    showMissionProgress: boolean;
    animationSpeed: 'Normal' | 'Fast' | 'Reduced';
    darkMode: boolean;
  };
  landingZone: {
    lat: number;
    lon: number;
  };
  payloadSecurity: {
    releasePin: string;
    tempMin: number;
    tempMax: number;
    stabilityAlertEnabled: boolean;
  };
}

const DEFAULT_SETTINGS: DroneMedicSettings = {
  profile: {
    displayName: 'Operator',
    email: '',
    role: 'Pilot',
  },
  notifications: {
    enabled: true,
    sound: true,
    missionComplete: true,
    lowBattery: true,
    noFlyBreach: true,
    weatherWarning: false,
  },
  drone: {
    defaultAltitude: 30,
    maxSpeed: 45,
    batteryLowThreshold: 20,
    batteryCriticalThreshold: 10,
    maxPayload: 2.0,
    returnOnLowBattery: true,
    autoAvoidNoFly: true,
    enableRerouting: true,
  },
  map: {
    defaultTileLayer: 'Dark',
    units: 'metric',
    showNoFlyZones: true,
    showWeatherOverlay: true,
    showDroneTrail: true,
  },
  display: {
    hudPosition: 'Right',
    showMissionProgress: true,
    animationSpeed: 'Normal',
    darkMode: true,
  },
  landingZone: {
    lat: 51.5074,
    lon: -0.1278,
  },
  payloadSecurity: {
    releasePin: '0000',
    tempMin: 2,
    tempMax: 8,
    stabilityAlertEnabled: true,
  },
};

const STORAGE_KEY = 'dronemedic-settings';

function deepMerge(defaults: DroneMedicSettings, saved: Partial<DroneMedicSettings>): DroneMedicSettings {
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof DroneMedicSettings)[]) {
    if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])) {
      (result as Record<string, unknown>)[key] = { ...defaults[key], ...saved[key] };
    } else if (saved[key] !== undefined) {
      (result as Record<string, unknown>)[key] = saved[key];
    }
  }
  return result;
}

function loadSettings(): DroneMedicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<DroneMedicSettings>;
    return deepMerge(DEFAULT_SETTINGS, saved);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<DroneMedicSettings>(loadSettings);

  const updateSettings = useCallback((partial: Partial<DroneMedicSettings>) => {
    setSettings(prev => {
      const next = deepMerge(prev, partial);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, updateSettings, resetSettings };
}
