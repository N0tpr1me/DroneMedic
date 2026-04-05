"""Computer vision obstacle detection service using YOLOv8.

Wraps the CVObstacleDetector from the simulation layer and provides a
high-level ``run_detection()`` call that returns structured data ready
for the event bus.  Falls back to realistic simulated detections when
the model or sample frames are unavailable.
"""

from __future__ import annotations

import logging
import random
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("DroneMedic.CVService")

# Sample frames live alongside the generator script
FRAMES_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "cv_frames"


class CVDetectionService:
    """Runs YOLOv8 inference on camera frames during flight."""

    def __init__(self) -> None:
        self._detector = None
        self._frames: list[Path] = []
        self._load_frames()

    # ── Setup ─────────────────────────────────────────────────────────

    def _load_frames(self) -> None:
        """Discover available sample frames on disk."""
        if FRAMES_DIR.exists():
            self._frames = sorted(
                list(FRAMES_DIR.glob("*.png")) + list(FRAMES_DIR.glob("*.jpg"))
            )
        if not self._frames:
            logger.warning("No sample frames found in %s", FRAMES_DIR)

    def _get_detector(self):
        """Lazy-load the CV detector to avoid slow startup."""
        if self._detector is None:
            try:
                from simulation.cv_obstacle_detector import CVObstacleDetector
                self._detector = CVObstacleDetector()
                logger.info("YOLOv8 obstacle detector loaded")
            except Exception as e:
                logger.warning("Could not load CV detector: %s", e)
        return self._detector

    # ── Public API ────────────────────────────────────────────────────

    def run_detection(self) -> dict[str, Any]:
        """Run YOLOv8 on a random sample frame and return detection results.

        Returns a dict suitable for publishing on the event bus::

            {
                "frame": "frame_02.png",
                "detections": [ {class, confidence, bbox, distance_m}, ... ],
                "evasion": {action, magnitude, reason} | None,
                "model": "YOLOv8n",
                "inference_ms": 23.4,
            }
        """
        detector = self._get_detector()

        if detector and self._frames:
            frame_path = random.choice(self._frames)
            try:
                return self._run_real_detection(detector, frame_path)
            except Exception as e:
                logger.warning("CV detection failed on %s: %s", frame_path.name, e)

        # Fallback: return simulated detection data for demo
        return self._simulated_detection()

    # ── Internals ─────────────────────────────────────────────────────

    def _run_real_detection(self, detector, frame_path: Path) -> dict[str, Any]:
        """Run the real YOLOv8 model on *frame_path* and normalise output."""
        import numpy as np
        from PIL import Image

        # Load image as BGR numpy array (OpenCV convention expected by YOLO)
        img = Image.open(frame_path).convert("RGB")
        frame_bgr = np.array(img)[:, :, ::-1].copy()

        start = time.perf_counter()
        detections = detector.detect(frame_bgr)
        elapsed_ms = (time.perf_counter() - start) * 1000

        evasion_vec = detector.get_evasion_vector(detections)

        serialised_detections = [
            {
                "class": d.class_name,
                "confidence": round(d.confidence, 3),
                "bbox": list(d.bbox),
                "distance_m": round(d.distance_estimate, 1),
            }
            for d in detections
        ]

        evasion: dict[str, Any] | None = None
        if evasion_vec is not None:
            evasion = {
                "action": f"evade_{evasion_vec.direction}",
                "magnitude": evasion_vec.magnitude,
                "reason": evasion_vec.reason,
            }

        return {
            "frame": frame_path.name,
            "detections": serialised_detections,
            "evasion": evasion,
            "model": "YOLOv8n",
            "inference_ms": round(elapsed_ms, 1),
        }

    @staticmethod
    def _simulated_detection() -> dict[str, Any]:
        """Produce realistic-looking simulated detection data."""
        return {
            "frame": "simulated",
            "detections": [
                {
                    "class": "building",
                    "confidence": 0.87,
                    "bbox": [120, 80, 340, 290],
                    "distance_m": 45,
                },
                {
                    "class": "vehicle",
                    "confidence": 0.72,
                    "bbox": [400, 200, 520, 280],
                    "distance_m": 78,
                },
            ],
            "evasion": {
                "action": "evade_left",
                "magnitude": 0.7,
                "reason": "Building detected 45m ahead at current heading",
            },
            "model": "YOLOv8n (simulated)",
            "inference_ms": 23,
        }
