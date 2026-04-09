import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X, Download, FileJson, ClipboardCopy, FileText } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import DOMPurify from 'dompurify';

interface ReportViewerProps {
  open: boolean;
  onClose: () => void;
  missionId: string;
  report?: string;
}

function formatTimestamp(): string {
  return new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:700;color:#b3c5ff;margin:16px 0 6px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;color:#00daf3;margin:20px 0 8px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:700;color:#ffffff;margin:20px 0 8px;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#dfe3e9">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(0,218,243,0.08);color:#00daf3;padding:1px 5px;border-radius:3px;font-size:12px;">$1</code>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc;margin-bottom:4px;">$1</li>')
    .replace(/^(?!<[hlu]|<li|<strong|<em|<code)(.+)$/gm, '<p style="margin:6px 0;line-height:1.6;">$1</p>');
}

export function ReportViewer({ open, onClose, missionId, report }: ReportViewerProps) {
  const [copied, setCopied] = useState(false);
  const isLoading = report === undefined;

  function handleDownloadPdf() {
    if (!report) return;
    downloadBlob(report, `mission-${missionId}-report.txt`, 'text/plain');
  }

  function handleDownloadJson() {
    if (!report) return;
    const json = JSON.stringify(
      { missionId, generatedAt: new Date().toISOString(), report },
      null,
      2,
    );
    downloadBlob(json, `mission-${missionId}-report.json`, 'application/json');
  }

  function handleCopy() {
    if (!report) return;
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 6,
    border: '1px solid rgba(141,144,160,0.2)',
    background: 'rgba(15,20,24,0.6)',
    color: '#b3c5ff',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif",
    transition: 'background 0.15s',
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
            zIndex: 50,
          }}
        />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'fixed',
              inset: 24,
              background: 'rgba(23,28,32,0.95)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(141,144,160,0.12)',
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'column',
              zIndex: 51,
              fontFamily: "'Space Grotesk', sans-serif",
              color: '#c3c6d6',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 24px',
                borderBottom: '1px solid rgba(141,144,160,0.1)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={18} color="#00daf3" />
                <div>
                  <Dialog.Title style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', margin: 0 }}>
                    Mission Report
                  </Dialog.Title>
                  <p style={{ fontSize: 11, color: '#8d90a0', margin: '2px 0 0' }}>
                    {missionId} — {formatTimestamp()}
                  </p>
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  style={{ background: 'none', border: 'none', color: '#8d90a0', cursor: 'pointer', padding: 4 }}
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>

            {/* Report body */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px 28px',
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
                  <Skeleton variant="text" width="70%" />
                  <Skeleton variant="text" count={4} />
                  <Skeleton variant="rect" height={80} />
                  <Skeleton variant="text" count={3} />
                  <Skeleton variant="text" width="50%" />
                </div>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(report)) }} />
              )}
            </div>

            {/* Action bar */}
            <div
              style={{
                display: 'flex',
                gap: 10,
                padding: '14px 24px',
                borderTop: '1px solid rgba(141,144,160,0.1)',
                flexShrink: 0,
              }}
            >
              <button onClick={handleDownloadPdf} disabled={isLoading} style={btnStyle}>
                <Download size={13} /> Download PDF
              </button>
              <button onClick={handleDownloadJson} disabled={isLoading} style={btnStyle}>
                <FileJson size={13} /> Download JSON
              </button>
              <button onClick={handleCopy} disabled={isLoading} style={{
                ...btnStyle,
                color: copied ? '#22c55e' : '#b3c5ff',
              }}>
                <ClipboardCopy size={13} /> {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
