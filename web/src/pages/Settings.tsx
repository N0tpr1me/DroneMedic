import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Settings as SettingsIcon, User, MapPin, Lock, LogOut, RotateCcw, KeyRound, PlaneTakeoff } from 'lucide-react';
import { HudStatus } from '../components/ui/hud-status';
import { LiquidButton } from '@/components/ui/liquid-glass-button';
import { SideNav } from '../components/layout/SideNav';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';

// Fix leaflet default marker icon
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// ── Inline toggle switch ──
function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11, padding: 2,
        background: value ? '#00daf3' : '#30353a',
        border: 'none', cursor: 'pointer', transition: 'background 0.2s',
        display: 'flex', alignItems: 'center',
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'transform 0.2s',
        transform: value ? 'translateX(18px)' : 'translateX(0)',
      }} />
    </button>
  );
}

// ── Setting row ──
function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid rgba(67,70,84,0.15)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#dfe3e9' }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: '#8d90a0', marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{ marginLeft: 16, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ── Styled select ──
function StyledSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: '#262b2f', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)',
        borderRadius: 6, padding: '6px 12px', fontSize: 12, outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ── Styled text input ──
function StyledInput({ value, onChange, placeholder, type = 'text', maxLength }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength?: number }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      style={{
        background: '#1b2024', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)',
        borderRadius: 6, padding: '8px 12px', fontSize: 13, outline: 'none', width: 200,
      }}
    />
  );
}

// ── Styled slider ──
function StyledSlider({ value, onChange, min, max, step = 1, unit }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: 120, accentColor: '#b3c5ff', cursor: 'pointer' }}
      />
      <span style={{ fontFamily: 'Space Grotesk', fontSize: 13, fontWeight: 700, color: '#b3c5ff', minWidth: 48, textAlign: 'right' }}>
        {step < 1 ? value.toFixed(1) : value}{unit || ''}
      </span>
    </div>
  );
}

// ── Draggable map marker handler ──
function DraggableMarkerHandler({ position, onPositionChange }: { position: [number, number]; onPositionChange: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPositionChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return (
    <Marker
      position={position}
      icon={markerIcon}
      draggable
      eventHandlers={{
        dragend: (e) => {
          const marker = e.target;
          const pos = marker.getLatLng();
          onPositionChange(pos.lat, pos.lng);
        },
      }}
    />
  );
}

// ── Glass panel wrapper ──
const panelStyle: React.CSSProperties = {
  background: 'rgba(30,35,40,0.85)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  borderRadius: 8,
  padding: 24,
  border: '1px solid rgba(67,70,84,0.25)',
};

const TAB_ITEMS = [
  { icon: <User size={16} />, label: 'Profile' },
  { icon: <PlaneTakeoff size={16} />, label: 'Drone' },
  { icon: <MapPin size={16} />, label: 'Map & Display' },
  { icon: <MapPin size={16} />, label: 'Landing Zone' },
  { icon: <Lock size={16} />, label: 'Payload Security' },
];

export function Settings() {
  const navigate = useNavigate();
  const { settings, updateSettings, resetSettings } = useSettings();
  const { signOut, user, changePassword } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const updateNested = useCallback(<K extends keyof typeof settings>(section: K, field: string, value: unknown) => {
    updateSettings({ [section]: { ...settings[section], [field]: value } } as Partial<typeof settings>);
  }, [settings, updateSettings]);

  return (
    <div style={{ height: '100vh', background: '#0f1418', overflow: 'hidden', color: '#dfe3e9', fontFamily: 'Inter,sans-serif' }}>

      {/* ═══ HEADER ═══ */}
      <header style={{ position: 'fixed', top: 0, width: '100%', zIndex: 50, background: 'rgba(15,20,24,0.50)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px', height: 64, borderBottom: '1px solid rgba(67,70,84,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span onClick={() => navigate('/dashboard')} style={{ fontSize: 18, fontWeight: 900, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Space Grotesk,sans-serif', cursor: 'pointer' }}>DroneMedic</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon size={20} style={{ color: '#b3c5ff' }} />
          <h1 style={{ fontFamily: 'Space Grotesk', fontSize: 16, fontWeight: 700, color: '#dfe3e9', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Settings</h1>
        </div>
        <HudStatus variant="idle" />
      </header>

      {/* ═══ LEFT NAV ═══ */}
      <SideNav currentPage="settings" />

      {/* ═══ MAIN CONTENT ═══ */}
      <main style={{ marginLeft: 100, paddingTop: 80, height: '100vh', overflowY: 'auto', paddingBottom: 80, position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px' }}>

          {/* Page title */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: 800, color: '#dfe3e9', margin: 0 }}>Settings</h2>
            <p style={{ fontSize: 13, color: '#8d90a0', marginTop: 4 }}>Configure your mission parameters, display preferences, and security.</p>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
            {TAB_ITEMS.map((tab, i) => (
              <button
                key={tab.label}
                onClick={() => setActiveTab(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: activeTab === i ? 'rgba(179,197,255,0.12)' : 'transparent',
                  color: activeTab === i ? '#b3c5ff' : '#8d90a0',
                  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                  transition: 'all 0.2s',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Profile & Notifications ── */}
          {activeTab === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={panelStyle}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Account</h3>
                <SettingRow label="Email" description="Your login email address">
                  <span style={{ fontSize: 13, color: '#dfe3e9', fontFamily: 'Space Grotesk', fontWeight: 600 }}>
                    {user?.email || 'Demo Mode'}
                  </span>
                </SettingRow>
                <SettingRow label="Clinic / Hospital Name" description="Your facility name shown in mission logs">
                  <StyledInput value={settings.profile.displayName} onChange={v => updateNested('profile', 'displayName', v)} placeholder="e.g. St. Mary's Hospital" />
                </SettingRow>
              </div>
              <div style={panelStyle}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Change Password</h3>
                <SettingRow label="New Password" description="Minimum 6 characters">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="New password"
                    style={{ background: '#1b2024', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)', borderRadius: 6, padding: '8px 12px', fontSize: 13, outline: 'none', width: 200 }}
                  />
                </SettingRow>
                <SettingRow label="Confirm Password">
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    style={{ background: '#1b2024', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)', borderRadius: 6, padding: '8px 12px', fontSize: 13, outline: 'none', width: 200 }}
                  />
                </SettingRow>
                {passwordMsg && (
                  <div style={{ padding: '8px 12px', borderRadius: 6, marginTop: 8, fontSize: 12, background: passwordMsg.type === 'success' ? 'rgba(0,218,243,0.1)' : 'rgba(164,2,19,0.15)', color: passwordMsg.type === 'success' ? '#00daf3' : '#ffb3ac', border: `1px solid ${passwordMsg.type === 'success' ? 'rgba(0,218,243,0.25)' : 'rgba(164,2,19,0.3)'}` }}>
                    {passwordMsg.text}
                  </div>
                )}
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={async () => {
                      setPasswordMsg(null);
                      if (newPassword.length < 6) { setPasswordMsg({ type: 'error', text: 'Password must be at least 6 characters.' }); return; }
                      if (newPassword !== confirmPassword) { setPasswordMsg({ type: 'error', text: 'Passwords do not match.' }); return; }
                      try {
                        await changePassword(newPassword);
                        setPasswordMsg({ type: 'success', text: 'Password updated successfully.' });
                        setNewPassword(''); setConfirmPassword('');
                      } catch (err) {
                        setPasswordMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update password.' });
                      }
                    }}
                    disabled={!newPassword || !confirmPassword}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 18px', borderRadius: 6, cursor: 'pointer',
                      background: 'rgba(179,197,255,0.12)', border: '1px solid rgba(179,197,255,0.25)',
                      color: '#b3c5ff', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                      opacity: (!newPassword || !confirmPassword) ? 0.4 : 1, transition: 'all 0.2s',
                    }}
                  >
                    <KeyRound size={14} />
                    Update Password
                  </button>
                </div>
              </div>
              <div style={panelStyle}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Notifications</h3>
                <SettingRow label="Enable Notifications" description="Master toggle for all alerts">
                  <ToggleSwitch value={settings.notifications.enabled} onChange={v => updateNested('notifications', 'enabled', v)} />
                </SettingRow>
                <SettingRow label="Sound Alerts">
                  <ToggleSwitch value={settings.notifications.sound} onChange={v => updateNested('notifications', 'sound', v)} />
                </SettingRow>
                <SettingRow label="Mission Complete">
                  <ToggleSwitch value={settings.notifications.missionComplete} onChange={v => updateNested('notifications', 'missionComplete', v)} />
                </SettingRow>
                <SettingRow label="Low Battery Warning">
                  <ToggleSwitch value={settings.notifications.lowBattery} onChange={v => updateNested('notifications', 'lowBattery', v)} />
                </SettingRow>
                <SettingRow label="No-Fly Zone Breach">
                  <ToggleSwitch value={settings.notifications.noFlyBreach} onChange={v => updateNested('notifications', 'noFlyBreach', v)} />
                </SettingRow>
                <SettingRow label="Weather Warning">
                  <ToggleSwitch value={settings.notifications.weatherWarning} onChange={v => updateNested('notifications', 'weatherWarning', v)} />
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── Tab: Drone Configuration ── */}
          {activeTab === 1 && (
            <div style={panelStyle}>
              <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Flight Parameters</h3>
              <SettingRow label="Default Altitude" description="Cruising altitude for missions">
                <StyledSlider value={settings.drone.defaultAltitude} onChange={v => updateNested('drone', 'defaultAltitude', v)} min={10} max={120} unit="m" />
              </SettingRow>
              <SettingRow label="Max Speed" description="Speed limit during flight">
                <StyledSlider value={settings.drone.maxSpeed} onChange={v => updateNested('drone', 'maxSpeed', v)} min={10} max={80} unit=" km/h" />
              </SettingRow>
              <SettingRow label="Battery Low Threshold" description="Warning when battery drops below">
                <StyledSlider value={settings.drone.batteryLowThreshold} onChange={v => updateNested('drone', 'batteryLowThreshold', v)} min={5} max={40} unit="%" />
              </SettingRow>
              <SettingRow label="Battery Critical Threshold" description="Emergency return triggered below">
                <StyledSlider value={settings.drone.batteryCriticalThreshold} onChange={v => updateNested('drone', 'batteryCriticalThreshold', v)} min={5} max={20} unit="%" />
              </SettingRow>
              <SettingRow label="Max Payload Weight" description="Maximum cargo weight">
                <StyledSlider value={settings.drone.maxPayload} onChange={v => updateNested('drone', 'maxPayload', v)} min={0.5} max={5} step={0.1} unit=" kg" />
              </SettingRow>
              <SettingRow label="Return-to-Home on Low Battery">
                <ToggleSwitch value={settings.drone.returnOnLowBattery} onChange={v => updateNested('drone', 'returnOnLowBattery', v)} />
              </SettingRow>
              <SettingRow label="Auto-Avoid No-Fly Zones">
                <ToggleSwitch value={settings.drone.autoAvoidNoFly} onChange={v => updateNested('drone', 'autoAvoidNoFly', v)} />
              </SettingRow>
              <SettingRow label="Enable Dynamic Rerouting" description="Reroute around weather and obstacles">
                <ToggleSwitch value={settings.drone.enableRerouting} onChange={v => updateNested('drone', 'enableRerouting', v)} />
              </SettingRow>
            </div>
          )}

          {/* ── Tab: Map & Display ── */}
          {activeTab === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={panelStyle}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Map</h3>
                <SettingRow label="Default Tile Layer">
                  <StyledSelect value={settings.map.defaultTileLayer} onChange={v => updateNested('map', 'defaultTileLayer', v)} options={['Dark', 'Satellite', 'Street', 'Topographic']} />
                </SettingRow>
                <SettingRow label="Units">
                  <StyledSelect value={settings.map.units} onChange={v => updateNested('map', 'units', v)} options={['metric', 'imperial']} />
                </SettingRow>
                <SettingRow label="Show No-Fly Zones" description="Display restricted airspace polygons on map">
                  <ToggleSwitch value={settings.map.showNoFlyZones} onChange={v => updateNested('map', 'showNoFlyZones', v)} />
                </SettingRow>
                <SettingRow label="Show Weather Overlay">
                  <ToggleSwitch value={settings.map.showWeatherOverlay} onChange={v => updateNested('map', 'showWeatherOverlay', v)} />
                </SettingRow>
                <SettingRow label="Show Drone Trail" description="Display path history during flight">
                  <ToggleSwitch value={settings.map.showDroneTrail} onChange={v => updateNested('map', 'showDroneTrail', v)} />
                </SettingRow>
              </div>
              <div style={panelStyle}>
                <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Display</h3>
                <SettingRow label="HUD Position">
                  <StyledSelect value={settings.display.hudPosition} onChange={v => updateNested('display', 'hudPosition', v)} options={['Right', 'Left']} />
                </SettingRow>
                <SettingRow label="Show Mission Progress Bar">
                  <ToggleSwitch value={settings.display.showMissionProgress} onChange={v => updateNested('display', 'showMissionProgress', v)} />
                </SettingRow>
                <SettingRow label="Animation Speed">
                  <StyledSelect value={settings.display.animationSpeed} onChange={v => updateNested('display', 'animationSpeed', v)} options={['Normal', 'Fast', 'Reduced']} />
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── Tab: Landing Zone ── */}
          {activeTab === 3 && (
            <div style={panelStyle}>
              <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Landing Zone Configuration</h3>
              <p style={{ fontSize: 12, color: '#8d90a0', marginBottom: 16 }}>Click on the map or drag the marker to set your clinic's drone landing coordinates.</p>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(67,70,84,0.25)', height: 350, marginBottom: 16 }}>
                <MapContainer
                  center={[settings.landingZone.lat, settings.landingZone.lon]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                  attributionControl={false}
                >
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                  <DraggableMarkerHandler
                    position={[settings.landingZone.lat, settings.landingZone.lon]}
                    onPositionChange={(lat, lon) => updateSettings({ landingZone: { lat, lon } })}
                  />
                </MapContainer>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#8d90a0', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: 4 }}>Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={settings.landingZone.lat}
                    onChange={e => updateSettings({ landingZone: { ...settings.landingZone, lat: Number(e.target.value) } })}
                    style={{ width: '100%', background: '#1b2024', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)', borderRadius: 6, padding: '10px 12px', fontSize: 13, outline: 'none', fontFamily: 'Space Grotesk' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#8d90a0', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, display: 'block', marginBottom: 4 }}>Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={settings.landingZone.lon}
                    onChange={e => updateSettings({ landingZone: { ...settings.landingZone, lon: Number(e.target.value) } })}
                    style={{ width: '100%', background: '#1b2024', color: '#dfe3e9', border: '1px solid rgba(67,70,84,0.25)', borderRadius: 6, padding: '10px 12px', fontSize: 13, outline: 'none', fontFamily: 'Space Grotesk' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Payload Security ── */}
          {activeTab === 4 && (
            <div style={panelStyle}>
              <h3 style={{ fontFamily: 'Space Grotesk', fontSize: 14, fontWeight: 700, color: '#b3c5ff', textTransform: 'uppercase', letterSpacing: '0.02em', margin: '0 0 8px' }}>Payload Security</h3>
              <SettingRow label="Release PIN" description="4-digit code required to unlock drone hatch on arrival">
                <StyledInput
                  value={settings.payloadSecurity.releasePin}
                  onChange={v => {
                    const filtered = v.replace(/\D/g, '').slice(0, 4);
                    updateNested('payloadSecurity', 'releasePin', filtered);
                  }}
                  placeholder="0000"
                  maxLength={4}
                />
              </SettingRow>
              <SettingRow label="Safe Temperature Min" description="Minimum safe temp for cold chain cargo">
                <StyledSlider value={settings.payloadSecurity.tempMin} onChange={v => updateNested('payloadSecurity', 'tempMin', v)} min={-10} max={15} unit="°C" />
              </SettingRow>
              <SettingRow label="Safe Temperature Max" description="Maximum safe temp for cold chain cargo">
                <StyledSlider value={settings.payloadSecurity.tempMax} onChange={v => updateNested('payloadSecurity', 'tempMax', v)} min={0} max={30} unit="°C" />
              </SettingRow>
              <SettingRow label="Stability Alert" description="Alert when temperature deviates from safe range">
                <ToggleSwitch value={settings.payloadSecurity.stabilityAlertEnabled} onChange={v => updateNested('payloadSecurity', 'stabilityAlertEnabled', v)} />
              </SettingRow>
            </div>
          )}

          {/* ── Reset button ── */}
          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between' }}>
            <button
              onClick={async () => { sessionStorage.removeItem('dronemedic-demo'); await signOut(); navigate('/'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(67,70,84,0.2)', border: '1px solid rgba(67,70,84,0.4)',
                color: '#c3c6d6', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                transition: 'all 0.2s',
              }}
            >
              <LogOut size={16} />
              Log Out
            </button>
            <button
              onClick={resetSettings}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(164,2,19,0.2)', border: '1px solid rgba(164,2,19,0.4)',
                color: '#ffb3ac', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                transition: 'all 0.2s',
              }}
            >
              <RotateCcw size={16} />
              Reset to Defaults
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}
