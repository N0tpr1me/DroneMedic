import { useState, useRef, useCallback } from 'react';

interface UseSTTResult {
  recording: boolean;
  transcript: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  error: string | null;
}

export function useSTT(): UseSTTResult {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscript(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());

        try {
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          setTranscript(data.text || null);
          if (data.error) setError(data.error);
        } catch {
          setError('Transcription failed');
        }
      };

      recorder.start();
      mediaRecorder.current = recorder;
      setRecording(true);
    } catch {
      setError('Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (
      mediaRecorder.current &&
      mediaRecorder.current.state !== 'inactive'
    ) {
      mediaRecorder.current.stop();
      setRecording(false);
    }
  }, []);

  return { recording, transcript, startRecording, stopRecording, error };
}
