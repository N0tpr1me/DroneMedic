"""TTS and STT API endpoints."""
from __future__ import annotations

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

from backend.api.dependencies import get_tts

router = APIRouter(tags=["audio"])


class TTSRequest(BaseModel):
    text: str
    style: str = "flight_controller"


@router.post("/api/tts")
async def text_to_speech(req: TTSRequest):
    """Convert text to speech audio."""
    tts = get_tts()
    if not tts or not tts.available():
        return Response(
            content=b"",
            status_code=503,
            headers={"Content-Type": "application/json"},
        )

    audio = tts.synthesize(req.text, req.style)
    if audio is None:
        return Response(content=b"", status_code=500)

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=narration.mp3"},
    )


@router.post("/api/tts/event")
async def narrate_event(event_type: str, details: dict):
    """Generate narration for a flight event."""
    tts = get_tts()
    if not tts:
        return {"error": "TTS unavailable"}
    audio = tts.narrate_event(event_type, details)
    if audio is None:
        return {"error": "Narration failed"}
    return Response(content=audio, media_type="audio/mpeg")


@router.post("/api/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """Transcribe audio to text using GPT-4o-transcribe."""
    from config import OPENAI_API_KEY, OPENAI_BASE_URL
    from openai import OpenAI

    if not OPENAI_API_KEY:
        return {"text": "", "error": "OpenAI API not configured"}

    try:
        client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
        response = client.audio.transcriptions.create(
            model="gpt-4o-transcribe",
            file=audio.file,
        )
        return {"text": response.text}
    except Exception:
        return {"text": "", "error": "Transcription failed"}
