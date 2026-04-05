"""DroneMedic — Inference routes for local model + Triton status."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ai.local_model import LocalParser

router = APIRouter(tags=["Inference"])

# Singleton parser instance
_parser: LocalParser | None = None


def _get_parser() -> LocalParser:
    global _parser
    if _parser is None:
        _parser = LocalParser()
    return _parser


# ── Request / Response models ─────────────────────────────────────────

class ParseRequest(BaseModel):
    text: str


class ParseResponse(BaseModel):
    locations: list[str]
    priorities: dict[str, str]
    supplies: dict[str, str]
    constraints: dict[str, Any]
    parser: str
    model_info: dict[str, Any]


# ── Triton config loader ─────────────────────────────────────────────

_TRITON_MODELS_DIR = (
    Path(__file__).resolve().parents[3] / "simulation" / "triton_config" / "models"
)

TRITON_MODELS: list[dict[str, Any]] = [
    {
        "name": "yolov8n_obstacle",
        "platform": "onnxruntime_onnx",
        "precision": "FP16",
        "purpose": "Real-time obstacle detection from drone camera feed",
        "latency_ms": {"t4": 8, "jetson_orin": 25, "rtx_4090": 3},
        "throughput": "125 fps (T4)",
    },
    {
        "name": "maintenance_lstm",
        "platform": "pytorch_libtorch",
        "precision": "FP32",
        "purpose": "Predictive maintenance from telemetry sequences",
        "latency_ms": {"t4": 2, "jetson_orin": 8, "rtx_4090": 1},
        "throughput": "500 req/s (T4)",
    },
    {
        "name": "local_parser",
        "platform": "onnxruntime_onnx",
        "precision": "INT4 (nf4 quantized)",
        "purpose": "Offline NL task parsing via Phi-3-mini + LoRA",
        "latency_ms": {"t4": 50, "jetson_orin": 200, "rtx_4090": 15},
        "throughput": "20 req/s (T4)",
    },
]


# ── Routes ────────────────────────────────────────────────────────────

@router.get("/api/inference/status")
def inference_status() -> dict[str, Any]:
    """Return local model info + Triton model repository status."""
    parser = _get_parser()
    parser_status = parser.get_status()

    triton_configs_present = _TRITON_MODELS_DIR.exists()
    models_with_config = []
    if triton_configs_present:
        for model_dir in sorted(_TRITON_MODELS_DIR.iterdir()):
            config_file = model_dir / "config.pbtxt"
            if config_file.exists():
                models_with_config.append(model_dir.name)

    return {
        "local_parser": parser_status,
        "triton": {
            "config_present": triton_configs_present,
            "models_configured": models_with_config,
            "model_details": TRITON_MODELS,
            "deployment_cmd": (
                "docker run --gpus all -p 8001:8001 "
                "-v $(pwd)/simulation/triton_config/models:/models "
                "nvcr.io/nvidia/tritonserver:24.01-py3 "
                "--model-repository=/models"
            ),
        },
        "gpu_targets": {
            "primary": "NVIDIA T4 (cloud inference)",
            "edge": "NVIDIA Jetson Orin (on-drone)",
            "dev": "RTX 4090 (development)",
        },
    }


@router.post("/api/parse-local", response_model=ParseResponse)
def parse_local(req: ParseRequest) -> dict[str, Any]:
    """Parse a delivery request using the offline local model."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text input must not be empty")
    parser = _get_parser()
    return parser.parse(req.text)
