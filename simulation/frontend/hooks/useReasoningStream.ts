import { useState, useRef, useCallback } from 'react';

interface ReasoningChunk {
  type: 'text' | 'action' | 'done' | 'error';
  content: string;
  tool?: string;
  timestamp: number;
}

interface UseReasoningStreamReturn {
  chunks: ReasoningChunk[];
  reasoningText: string;
  isStreaming: boolean;
  startStream: (command: string) => void;
  stopStream: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export function useReasoningStream(): UseReasoningStreamReturn {
  const [chunks, setChunks] = useState<ReasoningChunk[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(
    (command: string) => {
      // Close any existing stream
      stopStream();

      setChunks([]);
      setReasoningText('');
      setIsStreaming(true);

      const url = `${API_BASE}/api/reasoning-stream?command=${encodeURIComponent(command)}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type?: string;
            content?: string;
            tool?: string;
          };
          const chunk: ReasoningChunk = {
            type: (data.type as ReasoningChunk['type']) ?? 'text',
            content: data.content ?? '',
            tool: data.tool,
            timestamp: Date.now(),
          };

          setChunks((prev) => [...prev, chunk]);

          if (chunk.type === 'text') {
            setReasoningText((prev) => prev + chunk.content);
          }

          if (chunk.type === 'done' || chunk.type === 'error') {
            eventSource.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
          }
        } catch {
          // Ignore malformed events
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
      };
    },
    [stopStream],
  );

  return { chunks, reasoningText, isStreaming, startStream, stopStream };
}
