import { useState, useEffect, useRef, useCallback } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

interface UseVoiceInputOptions {
  onResult?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  continuous?: boolean;
  lang?: string;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
}

export function useVoiceInput({
  onResult,
  onInterim,
  continuous = false,
  lang = 'en-US',
}: UseVoiceInputOptions = {}): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);

  const SpeechRecognitionCtor =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;

  const isSupported = Boolean(SpeechRecognitionCtor);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) return;

    // Stop any existing instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript && onInterim) {
        onInterim(interimTranscript);
      }

      if (finalTranscript && onResult) {
        onResult(finalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') return;
      shouldRestartRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      if (shouldRestartRef.current && continuous) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
          shouldRestartRef.current = false;
        }
        return;
      }
      setIsListening(false);
    };

    shouldRestartRef.current = continuous;
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [SpeechRecognitionCtor, continuous, lang, onResult, onInterim]);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isListening, isSupported, start, stop };
}
