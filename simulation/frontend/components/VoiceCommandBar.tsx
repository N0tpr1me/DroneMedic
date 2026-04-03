import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { GlassPanel } from '../ui/GlassPanel';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface CommandResult {
  action: string;
  explanation: string;
  success: boolean;
}

export function VoiceCommandBar() {
  const [textInput, setTextInput] = useState('');
  const [interimText, setInterimText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVoiceResult = useCallback((transcript: string) => {
    setTextInput(transcript);
    setInterimText('');
  }, []);

  const handleInterim = useCallback((transcript: string) => {
    setInterimText(transcript);
  }, []);

  const { isListening, isSupported, start, stop } = useVoiceInput({
    onResult: handleVoiceResult,
    onInterim: handleInterim,
    continuous: false,
    lang: 'en-US',
  });

  const submitCommand = async (command: string) => {
    if (!command.trim()) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/voice-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      const data = (await res.json()) as CommandResult;
      setResult(data);
      setTextInput('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Command failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    submitCommand(textInput);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stop();
    } else {
      setInterimText('');
      start();
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-tertiary">
        <Mic className="w-4 h-4" />
        <span className="text-sm font-medium">Voice Command</span>
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleListening}
          disabled={!isSupported}
          className={`
            relative flex items-center justify-center w-10 h-10 rounded-full
            transition-all duration-200 shrink-0
            ${
              isListening
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'bg-white/5 text-on-surface-variant border border-outline-variant/30 hover:bg-white/10'
            }
            ${!isSupported ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          `}
          title={!isSupported ? 'Voice input not supported in this browser' : undefined}
        >
          {isListening ? (
            <>
              <MicOff className="w-4 h-4 relative z-10" />
              <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
            </>
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        <input
          type="text"
          value={interimText || textInput}
          onChange={(e) => {
            setTextInput(e.target.value);
            setInterimText('');
          }}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening...' : 'Type a command or use voice...'}
          className={`
            flex-1 bg-white/5 border border-outline-variant/30 rounded-xl px-3 py-2.5
            text-sm text-on-surface placeholder-on-surface-variant/50
            focus:outline-none focus:border-tertiary/50 transition-colors
            ${interimText ? 'italic text-on-surface-variant' : ''}
          `}
          disabled={loading}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || (!textInput.trim() && !interimText.trim())}
          className="
            flex items-center justify-center w-10 h-10 rounded-full shrink-0
            bg-tertiary/20 text-tertiary border border-tertiary/30
            hover:bg-tertiary/30 transition-all duration-200
            disabled:opacity-40 disabled:cursor-not-allowed
          "
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Interim transcript indicator */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 text-xs text-red-400"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Listening... speak your command</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`
              rounded-xl p-3 text-sm border
              ${
                result.success
                  ? 'bg-success/10 border-success/20 text-success'
                  : 'bg-error/10 border-error/20 text-error'
              }
            `}
          >
            <div className="font-medium">{result.action}</div>
            <div className="mt-1 text-xs opacity-80">{result.explanation}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-3 text-sm bg-error/10 border border-error/20 text-error"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
