import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapPin, Building2, Hospital, Warehouse } from 'lucide-react';
import { useFacilities } from '../../hooks/useSupabase';

// Fallback locations from config.py when Supabase is unavailable
const FALLBACK_FACILITIES = [
  { name: 'Depot', facility_type: 'depot', lat: 51.5074, lon: -0.1278 },
  { name: 'Clinic A', facility_type: 'clinic', lat: 51.5124, lon: -0.1200 },
  { name: 'Clinic B', facility_type: 'clinic', lat: 51.5174, lon: -0.1350 },
  { name: 'Clinic C', facility_type: 'clinic', lat: 51.5044, lon: -0.1100 },
  { name: 'Clinic D', facility_type: 'clinic', lat: 51.5000, lon: -0.1400 },
  { name: 'Royal London', facility_type: 'hospital', lat: 51.5185, lon: -0.0590 },
  { name: 'Homerton', facility_type: 'hospital', lat: 51.5468, lon: -0.0456 },
  { name: 'Newham General', facility_type: 'hospital', lat: 51.5155, lon: 0.0285 },
  { name: 'Whipps Cross', facility_type: 'hospital', lat: 51.5690, lon: 0.0066 },
];

// Depot coords for distance calculation
const DEPOT_LAT = 51.5074;
const DEPOT_LON = -0.1278;

interface FacilityAutocompleteProps {
  value: string;
  onChange: (facility: string) => void;
  placeholder?: string;
}

interface FacilityOption {
  name: string;
  facility_type: string;
  lat: number;
  lon: number;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'hospital':
      return Hospital;
    case 'depot':
      return Warehouse;
    default:
      return Building2;
  }
}

function getTypeBadgeColor(type: string): { bg: string; text: string; border: string } {
  switch (type) {
    case 'hospital':
      return { bg: 'rgba(239,68,68,0.12)', text: '#f87171', border: 'rgba(239,68,68,0.3)' };
    case 'depot':
      return { bg: 'rgba(34,197,94,0.12)', text: '#4ade80', border: 'rgba(34,197,94,0.3)' };
    default:
      return { bg: 'rgba(59,130,246,0.12)', text: '#60a5fa', border: 'rgba(59,130,246,0.3)' };
  }
}

export function FacilityAutocomplete({ value, onChange, placeholder = 'Search facilities...' }: FacilityAutocompleteProps) {
  const { facilities: supaFacilities, error: supaError } = useFacilities();
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Debounced query update
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Resolve facility list: Supabase data or fallback
  const allFacilities: FacilityOption[] = useMemo(() => {
    if (supaFacilities.length > 0 && !supaError) {
      return supaFacilities.map((f) => ({
        name: f.name,
        facility_type: f.facility_type,
        lat: f.lat,
        lon: f.lon,
      }));
    }
    return FALLBACK_FACILITIES;
  }, [supaFacilities, supaError]);

  // Filter facilities based on debounced query
  const filtered = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    if (!q) return allFacilities;
    return allFacilities.filter((f) => f.name.toLowerCase().includes(q));
  }, [allFacilities, debouncedQuery]);

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

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const selectFacility = useCallback(
    (name: string) => {
      setQuery(name);
      onChange(name);
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          selectFacility(filtered[activeIndex].name);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Input */}
      <div style={{ position: 'relative' }}>
        <MapPin
          size={16}
          style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#8d90a0',
            pointerEvents: 'none',
          }}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            padding: '10px 12px 10px 36px',
            background: 'rgba(255,255,255,0.04)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(67,70,84,0.25)',
            borderRadius: 10,
            color: '#dfe3e9',
            fontSize: 14,
            outline: 'none',
            transition: 'border-color 0.2s',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLInputElement).style.borderColor = 'rgba(0,218,243,0.4)';
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.target) {
              (e.target as HTMLInputElement).style.borderColor = 'rgba(67,70,84,0.25)';
            }
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor = 'rgba(67,70,84,0.25)';
          }}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: 'auto',
            margin: 0,
            padding: 4,
            listStyle: 'none',
            background: 'rgba(15,20,28,0.92)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(67,70,84,0.25)',
            borderRadius: 10,
            zIndex: 100,
          }}
        >
          {filtered.length === 0 ? (
            <li style={{ padding: '12px 14px', color: '#8d90a0', fontSize: 13, textAlign: 'center' }}>
              No facilities found
            </li>
          ) : (
            filtered.map((facility, idx) => {
              const isActive = idx === activeIndex;
              const dist = haversineKm(DEPOT_LAT, DEPOT_LON, facility.lat, facility.lon);
              const TypeIcon = getTypeIcon(facility.facility_type);
              const badge = getTypeBadgeColor(facility.facility_type);

              return (
                <li
                  key={facility.name}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectFacility(facility.name);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? 'rgba(0,218,243,0.08)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <TypeIcon size={16} style={{ color: badge.text, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#dfe3e9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {facility.name}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.border}`,
                      flexShrink: 0,
                    }}
                  >
                    {facility.facility_type}
                  </span>
                  <span style={{ fontSize: 11, color: '#8d90a0', flexShrink: 0 }}>
                    {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
