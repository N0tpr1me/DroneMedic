import { Mic, MicOff } from 'lucide-react';
import { useSTT } from '../../hooks/useSTT';
import { useEffect } from 'react';

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
}

export function VoiceButton({ onTranscript, className = '' }: VoiceButtonProps) {
  const { recording, transcript, startRecording, stopRecording, error } =
    useSTT();

  useEffect(() => {
    if (transcript) onTranscript(transcript);
  }, [transcript, onTranscript]);

  return (
    <button
      onClick={recording ? stopRecording : startRecording}
      className={`p-3 rounded-full transition-all ${
        recording
          ? 'bg-red-500/20 text-red-400 animate-pulse'
          : 'bg-[rgba(0,218,243,0.1)] text-[#00daf3] hover:bg-[rgba(0,218,243,0.2)]'
      } ${className}`}
      aria-label={recording ? 'Stop recording' : 'Start voice input'}
      title={
        error ||
        (recording
          ? 'Recording... click to stop'
          : 'Click to speak your delivery request')
      }
    >
      {recording ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  );
}
