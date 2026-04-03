import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BrainCog, Loader2, Play, Square } from 'lucide-react';
import { useReasoningStream } from '../../hooks/useReasoningStream';
import { GlassPanel } from '../ui/GlassPanel';

interface ReasoningLogProps {
  command?: string;
  autoStart?: boolean;
}

export function ReasoningLog({ command, autoStart = false }: ReasoningLogProps) {
  const { chunks, reasoningText, isStreaming, startStream, stopStream } =
    useReasoningStream();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoningText, chunks]);

  // Auto-start if command is provided
  useEffect(() => {
    if (autoStart && command) {
      startStream(command);
    }
    // Only trigger on mount with autoStart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actionChunks = chunks.filter((c) => c.type === 'action');

  return (
    <GlassPanel className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <BrainCog className="w-4 h-4 text-purple-400" />
            {isStreaming && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            )}
          </div>
          <span className="text-sm font-medium text-purple-400">
            AI Reasoning
          </span>
          {isStreaming && (
            <Loader2 className="w-3.5 h-3.5 text-purple-400/60 animate-spin" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isStreaming && command && (
            <button
              type="button"
              onClick={() => startStream(command)}
              className="
                flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                bg-purple-500/10 text-purple-400 border border-purple-500/20
                hover:bg-purple-500/20 transition-colors
              "
            >
              <Play className="w-3 h-3" />
              Start
            </button>
          )}
          {isStreaming && (
            <button
              type="button"
              onClick={stopStream}
              className="
                flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                bg-red-500/10 text-red-400 border border-red-500/20
                hover:bg-red-500/20 transition-colors
              "
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Tool execution badges */}
      <AnimatePresence>
        {actionChunks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-1.5"
          >
            {actionChunks.map((chunk, i) => (
              <motion.span
                key={`action-${i}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="
                  inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px]
                  bg-tertiary/10 text-tertiary border border-tertiary/20 font-medium
                "
              >
                <span className="w-1 h-1 rounded-full bg-tertiary" />
                Executing: {chunk.tool ?? chunk.content}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reasoning text panel */}
      <div
        ref={scrollRef}
        className="
          relative rounded-xl bg-black/30 border border-outline-variant/15
          p-3 max-h-64 overflow-y-auto
          font-mono text-xs leading-relaxed text-on-surface-variant
          scrollbar-thin scrollbar-thumb-outline-variant/20 scrollbar-track-transparent
        "
      >
        {reasoningText ? (
          <pre className="whitespace-pre-wrap break-words">{reasoningText}</pre>
        ) : (
          <span className="text-on-surface-variant/40 italic">
            {isStreaming
              ? 'Waiting for reasoning output...'
              : 'No reasoning data. Start a stream to see AI thinking.'}
          </span>
        )}

        {/* Blinking cursor when streaming */}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 -mb-0.5 bg-purple-400 animate-pulse" />
        )}
      </div>
    </GlassPanel>
  );
}
