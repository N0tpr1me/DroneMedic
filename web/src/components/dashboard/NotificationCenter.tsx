import { useState, useRef, useEffect, useMemo } from 'react';
import { Bell } from 'lucide-react';
import { useEvents } from '../../hooks/useSupabase';

interface NotificationCenterProps {
  className?: string;
}

function severityForEventType(type: string): 'green' | 'amber' | 'red' {
  const redTypes = [
    'mission_failed',
    'mission_aborted',
    'delivery_failed',
    'geofence_violation',
    'drone_battery_low',
    'obstacle_detected',
    'weather_alert',
  ];
  const amberTypes = [
    'reroute_requested',
    'reroute_completed',
    'mission_paused',
    'mission_reassigned',
    'scenario_triggered',
  ];

  if (redTypes.includes(type)) return 'red';
  if (amberTypes.includes(type)) return 'amber';
  return 'green';
}

function severityDotColor(severity: 'green' | 'amber' | 'red'): string {
  switch (severity) {
    case 'red':
      return '#ef4444';
    case 'amber':
      return '#f59e0b';
    default:
      return '#22c55e';
  }
}

function formatEventText(type: string, data: unknown): string {
  const labels: Record<string, string> = {
    mission_created: 'Mission created',
    mission_started: 'Mission started',
    mission_paused: 'Mission paused',
    mission_resumed: 'Mission resumed',
    mission_completed: 'Mission completed',
    mission_failed: 'Mission failed',
    mission_aborted: 'Mission aborted',
    mission_reassigned: 'Mission reassigned',
    drone_status_changed: 'Drone status changed',
    drone_position_updated: 'Drone position updated',
    drone_battery_low: 'Battery low warning',
    delivery_created: 'Delivery created',
    delivery_assigned: 'Delivery assigned',
    delivery_completed: 'Delivery completed',
    delivery_failed: 'Delivery failed',
    waypoint_reached: 'Waypoint reached',
    reroute_requested: 'Reroute requested',
    reroute_completed: 'Reroute completed',
    weather_alert: 'Weather alert',
    geofence_violation: 'Geofence violation',
    obstacle_detected: 'Obstacle detected',
    scenario_triggered: 'Scenario triggered',
  };

  const label = labels[type] ?? type.replace(/_/g, ' ');

  // Try to extract a meaningful detail from data
  if (data && typeof data === 'object' && 'message' in data) {
    return `${label}: ${(data as { message: string }).message}`;
  }

  return label;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function NotificationCenter({ className }: NotificationCenterProps) {
  const { events } = useEvents(undefined, 10);
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = useMemo(() => {
    return Math.max(0, events.length - lastSeenCount);
  }, [events.length, lastSeenCount]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      // Mark all as read on open
      setLastSeenCount(events.length);
    }
  };

  const handleMarkAllRead = () => {
    setLastSeenCount(events.length);
  };

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative' }}>
      {/* Bell Button */}
      <button
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 10,
          background: isOpen ? 'rgba(0,218,243,0.1)' : 'rgba(255,255,255,0.04)',
          border: isOpen ? '1px solid rgba(0,218,243,0.3)' : '1px solid rgba(67,70,84,0.2)',
          cursor: 'pointer',
          color: isOpen ? '#00daf3' : '#c3c6d6',
          transition: 'all 0.2s',
          padding: 0,
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              background: '#ef4444',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 320,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'rgba(15,20,28,0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(67,70,84,0.25)',
            borderRadius: 12,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 14px 8px',
              borderBottom: '1px solid rgba(67,70,84,0.15)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#dfe3e9' }}>Notifications</span>
            {events.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#00daf3',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Events */}
          {events.length === 0 ? (
            <div
              style={{
                padding: '32px 14px',
                textAlign: 'center',
                color: '#8d90a0',
                fontSize: 13,
              }}
            >
              No recent alerts
            </div>
          ) : (
            <div style={{ padding: 4 }}>
              {events.map((event) => {
                const severity = severityForEventType(event.type);
                const dotColor = severityDotColor(severity);
                const text = formatEventText(event.type, event.data);
                const time = relativeTime(event.created_at);

                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: dotColor,
                        marginTop: 5,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${dotColor}40`,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#c3c6d6',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {text}
                      </div>
                      <div style={{ fontSize: 10, color: '#6b6e7d', marginTop: 2 }}>{time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
