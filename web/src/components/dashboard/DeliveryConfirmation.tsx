import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X, PackageCheck } from 'lucide-react';

interface DeliveryConfirmationProps {
  open: boolean;
  onClose: () => void;
  missionId: string;
  destination: string;
  supply: string;
  onConfirm: (data: { recipient: string; role: string; condition: string }) => void;
}

const ROLES = ['Doctor', 'Nurse', 'Paramedic', 'Other'] as const;
const CONDITIONS = ['Intact', 'Minor Damage', 'Compromised'] as const;

function generateSignatureId(): string {
  const year = new Date().getFullYear();
  const code = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `#DM-${year}-${code}`;
}

function formatTimestamp(): string {
  return new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function DeliveryConfirmation({
  open,
  onClose,
  missionId,
  destination,
  supply,
  onConfirm,
}: DeliveryConfirmationProps) {
  const [recipient, setRecipient] = useState('');
  const [role, setRole] = useState<string>(ROLES[0]);
  const [condition, setCondition] = useState<string>(CONDITIONS[0]);
  const [signatureId] = useState(generateSignatureId);

  function handleConfirm() {
    if (!recipient.trim()) return;
    onConfirm({ recipient: recipient.trim(), role, condition });
    setRecipient('');
    setRole(ROLES[0]);
    setCondition(CONDITIONS[0]);
  }

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid rgba(141,144,160,0.2)',
    background: 'rgba(15,20,24,0.8)',
    color: '#dfe3e9',
    fontSize: 13,
    fontFamily: "'Space Grotesk', sans-serif",
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#8d90a0',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 4,
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 50,
          }}
        />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90vw',
              maxWidth: 440,
              background: 'rgba(23,28,32,0.92)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(141,144,160,0.15)',
              borderRadius: 12,
              padding: 24,
              zIndex: 51,
              color: '#dfe3e9',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PackageCheck size={18} color="#00daf3" />
                <Dialog.Title style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', margin: 0 }}>
                  Confirm Delivery
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#8d90a0',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            {/* Mission info strip */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                background: 'rgba(0,218,243,0.06)',
                border: '1px solid rgba(0,218,243,0.12)',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 11,
              }}
            >
              <div>
                <span style={{ color: '#8d90a0' }}>Mission </span>
                <span style={{ color: '#00daf3', fontWeight: 600 }}>{missionId}</span>
              </div>
              <div>
                <span style={{ color: '#8d90a0' }}>Dest </span>
                <span style={{ color: '#dfe3e9', fontWeight: 600 }}>{destination}</span>
              </div>
              <div>
                <span style={{ color: '#8d90a0' }}>Supply </span>
                <span style={{ color: '#dfe3e9', fontWeight: 600 }}>{supply}</span>
              </div>
            </div>

            {/* Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Recipient Name */}
              <div>
                <label style={labelStyle}>Recipient Name</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Enter recipient name"
                  style={{
                    ...selectStyle,
                  }}
                />
              </div>

              {/* Role */}
              <div>
                <label style={labelStyle}>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} style={selectStyle}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {/* Condition on Arrival */}
              <div>
                <label style={labelStyle}>Condition on Arrival</label>
                <select value={condition} onChange={(e) => setCondition(e.target.value)} style={selectStyle}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Signature ID + Timestamp */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <div>
                  <span style={{ fontSize: 10, color: '#8d90a0' }}>Signature ID </span>
                  <span style={{ fontSize: 12, color: '#00daf3', fontFamily: 'monospace', fontWeight: 600 }}>
                    {signatureId}
                  </span>
                </div>
                <span style={{ fontSize: 10, color: '#8d90a0', fontFamily: 'monospace' }}>
                  {formatTimestamp()}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: '1px solid rgba(141,144,160,0.2)',
                  background: 'transparent',
                  color: '#8d90a0',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!recipient.trim()}
                style={{
                  padding: '8px 22px',
                  borderRadius: 6,
                  border: 'none',
                  background: recipient.trim()
                    ? 'linear-gradient(135deg, #00daf3 0%, #0051ce 100%)'
                    : 'rgba(67,70,84,0.4)',
                  color: recipient.trim() ? '#ffffff' : '#6b7280',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: recipient.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: "'Space Grotesk', sans-serif",
                  letterSpacing: '0.02em',
                }}
              >
                Confirm Delivery
              </button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
