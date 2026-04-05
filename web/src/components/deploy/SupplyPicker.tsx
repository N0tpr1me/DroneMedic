import { useMemo, useCallback } from 'react';
import {
  Droplets,
  Syringe,
  Heart,
  BriefcaseMedical,
  Pill,
  FlaskConical,
  Bug,
  Scissors,
  Wind,
  Minus,
  Plus,
} from 'lucide-react';

// Supply catalog from config.SUPPLY_WEIGHTS
const SUPPLIES = [
  { id: 'blood_pack', name: 'Blood Pack', weight: 0.5, icon: Droplets },
  { id: 'vaccine_kit', name: 'Vaccine Kit', weight: 0.3, icon: Syringe },
  { id: 'defibrillator', name: 'Defibrillator', weight: 2.0, icon: Heart },
  { id: 'first_aid', name: 'First Aid', weight: 1.0, icon: BriefcaseMedical },
  { id: 'medication', name: 'Medication', weight: 0.2, icon: Pill },
  { id: 'insulin', name: 'Insulin', weight: 0.1, icon: FlaskConical },
  { id: 'antivenom', name: 'Antivenom', weight: 0.4, icon: Bug },
  { id: 'surgical_kit', name: 'Surgical Kit', weight: 1.5, icon: Scissors },
  { id: 'oxygen_tank', name: 'Oxygen Tank', weight: 3.0, icon: Wind },
] as const;

interface SupplyItem {
  supply: string;
  quantity: number;
}

interface SupplyPickerProps {
  selected: SupplyItem[];
  onChange: (items: SupplyItem[]) => void;
  maxPayloadKg?: number;
}

function getWeightColor(total: number, max: number): string {
  if (total > max) return '#ef4444';
  if (total >= max * 0.8) return '#f59e0b';
  return '#22c55e';
}

export function SupplyPicker({ selected, onChange, maxPayloadKg = 5.0 }: SupplyPickerProps) {
  const selectionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of selected) {
      map.set(item.supply, item.quantity);
    }
    return map;
  }, [selected]);

  const totalWeight = useMemo(() => {
    let total = 0;
    for (const item of selected) {
      const supply = SUPPLIES.find((s) => s.id === item.supply);
      if (supply) total += supply.weight * item.quantity;
    }
    return Math.round(total * 100) / 100;
  }, [selected]);

  const toggleSupply = useCallback(
    (supplyId: string) => {
      if (selectionMap.has(supplyId)) {
        onChange(selected.filter((s) => s.supply !== supplyId));
      } else {
        onChange([...selected, { supply: supplyId, quantity: 1 }]);
      }
    },
    [selected, selectionMap, onChange],
  );

  const updateQuantity = useCallback(
    (supplyId: string, delta: number) => {
      onChange(
        selected
          .map((s) => (s.supply === supplyId ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s))
          .filter((s) => s.quantity > 0),
      );
    },
    [selected, onChange],
  );

  const weightColor = getWeightColor(totalWeight, maxPayloadKg);
  const weightPercent = Math.min((totalWeight / maxPayloadKg) * 100, 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Supply Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {SUPPLIES.map((supply) => {
          const isSelected = selectionMap.has(supply.id);
          const qty = selectionMap.get(supply.id) ?? 0;
          const Icon = supply.icon;

          return (
            <div
              key={supply.id}
              onClick={() => toggleSupply(supply.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '12px 8px',
                borderRadius: 10,
                cursor: 'pointer',
                background: isSelected ? 'rgba(0,218,243,0.08)' : 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: isSelected
                  ? '1px solid rgba(0,218,243,0.5)'
                  : '1px solid rgba(67,70,84,0.2)',
                transition: 'all 0.2s',
                position: 'relative',
              }}
            >
              <Icon
                size={22}
                style={{
                  color: isSelected ? '#00daf3' : '#8d90a0',
                  transition: 'color 0.2s',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isSelected ? '#dfe3e9' : '#8d90a0',
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
              >
                {supply.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#6b6e7d',
                }}
              >
                {supply.weight}kg
              </span>

              {/* Quantity Controls */}
              {isSelected && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 2,
                  }}
                >
                  <button
                    onClick={() => updateQuantity(supply.id, -1)}
                    aria-label={`Decrease ${supply.name} quantity`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(67,70,84,0.3)',
                      color: '#c3c6d6',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <Minus size={12} />
                  </button>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: '#00daf3',
                      minWidth: 16,
                      textAlign: 'center',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {qty}
                  </span>
                  <button
                    onClick={() => updateQuantity(supply.id, 1)}
                    aria-label={`Increase ${supply.name} quantity`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(67,70,84,0.3)',
                      color: '#c3c6d6',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payload Weight Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(67,70,84,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#8d90a0' }}>Payload</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: weightColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {totalWeight.toFixed(1)} / {maxPayloadKg.toFixed(1)} kg
            </span>
            {totalWeight > maxPayloadKg && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(239,68,68,0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
              >
                OVER
              </span>
            )}
          </div>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${weightPercent}%`,
              borderRadius: 3,
              background: weightColor,
              transition: 'width 0.3s ease, background 0.3s ease',
            }}
          />
        </div>
      </div>
    </div>
  );
}
