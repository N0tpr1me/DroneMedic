"""
Vision-based obstacle detection using YOLOv8.

Uses a pre-trained YOLOv8 nano model for real-time obstacle detection
on drone camera feeds (Gazebo simulated camera or real camera).
Falls back to simulated detection when no camera is available.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger("DroneMedic.CVObstacle")


@dataclass
class Detection:
    class_name: str  # "person", "car", "tree", "building", etc.
    confidence: float  # 0.0-1.0
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2
    distance_estimate: float  # rough distance in meters (from bbox size)


@dataclass
class EvasionVector:
    direction: str  # "left", "right", "up", "stop"
    magnitude: float  # 0.0-1.0 (urgency)
    reason: str


class CVObstacleDetector:
    """YOLOv8-based obstacle detector with mock fallback."""

    # Obstacle classes that should trigger evasion
    OBSTACLE_CLASSES = {
        "person", "car", "truck", "bus", "bird", "airplane",
        "train", "boat", "bench", "chair", "potted plant",
        "building", "tree", "tower", "crane",
    }

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        confidence: float = 0.5,
        use_mock: bool = False,
    ) -> None:
        self.confidence_threshold = confidence
        self.use_mock = use_mock
        self._model = None
        self._detection_log: list[dict] = []

        if not use_mock:
            try:
                from ultralytics import YOLO
                self._model = YOLO(model_path)
                logger.info(f"YOLOv8 model loaded: {model_path}")
            except ImportError:
                logger.warning(
                    "ultralytics not installed, falling back to mock detection"
                )
                self.use_mock = True
            except Exception as e:
                logger.warning(f"Failed to load YOLO model: {e}, using mock")
                self.use_mock = True

    def detect(self, image_frame) -> list[Detection]:
        """Run detection on a camera frame (numpy array BGR).

        Args:
            image_frame: BGR numpy array from camera feed (or None in mock mode).

        Returns:
            List of Detection objects found in the frame.
        """
        if self.use_mock:
            return self._mock_detect()

        results = self._model(
            image_frame, conf=self.confidence_threshold, verbose=False
        )
        detections: list[Detection] = []
        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                cls_name = result.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())

                # Rough distance estimate from bbox height (larger bbox = closer)
                bbox_height = y2 - y1
                frame_height = (
                    image_frame.shape[0] if image_frame is not None else 480
                )
                distance = max(
                    1.0, 50.0 * (frame_height / max(bbox_height, 1))
                )

                detections.append(
                    Detection(
                        class_name=cls_name,
                        confidence=conf,
                        bbox=(x1, y1, x2, y2),
                        distance_estimate=distance,
                    )
                )

        self._log_detections(detections)
        return detections

    def is_obstacle_ahead(
        self,
        detections: list[Detection],
        threshold_distance: float = 30.0,
    ) -> bool:
        """Check if any obstacle-class detection is within threshold distance.

        Args:
            detections: List of Detection objects from detect().
            threshold_distance: Maximum distance in meters to consider dangerous.

        Returns:
            True if an obstacle-class object is closer than threshold_distance.
        """
        for d in detections:
            if (
                d.class_name in self.OBSTACLE_CLASSES
                and d.distance_estimate < threshold_distance
            ):
                return True
        return False

    def get_evasion_vector(
        self, detections: list[Detection]
    ) -> EvasionVector | None:
        """Compute evasion direction based on obstacle positions.

        Uses the closest obstacle's horizontal position relative to the frame
        center to decide whether to evade left, right, or stop.

        Args:
            detections: List of Detection objects from detect().

        Returns:
            EvasionVector with direction and urgency, or None if no evasion needed.
        """
        obstacles = [
            d
            for d in detections
            if d.class_name in self.OBSTACLE_CLASSES and d.distance_estimate < 30
        ]
        if not obstacles:
            return None

        closest = min(obstacles, key=lambda d: d.distance_estimate)
        # Determine direction: if obstacle is left of center, go right, and vice versa
        cx = (closest.bbox[0] + closest.bbox[2]) / 2
        frame_center = 320  # assume 640px width

        if closest.distance_estimate < 10:
            return EvasionVector(
                "stop",
                1.0,
                f"CRITICAL: {closest.class_name} at {closest.distance_estimate:.0f}m",
            )
        elif cx < frame_center:
            return EvasionVector(
                "right",
                0.7,
                f"{closest.class_name} on left at {closest.distance_estimate:.0f}m",
            )
        else:
            return EvasionVector(
                "left",
                0.7,
                f"{closest.class_name} on right at {closest.distance_estimate:.0f}m",
            )

    def _mock_detect(self) -> list[Detection]:
        """Simulated detection for testing without camera/model."""
        import random

        if random.random() < 0.15:  # 15% chance of obstacle
            return [
                Detection(
                    class_name=random.choice(
                        ["person", "car", "tree", "building"]
                    ),
                    confidence=random.uniform(0.6, 0.95),
                    bbox=(200, 150, 400, 350),
                    distance_estimate=random.uniform(5, 50),
                )
            ]
        return []

    def _log_detections(self, detections: list[Detection]) -> None:
        """Record obstacle-class detections to the internal log."""
        for d in detections:
            if d.class_name in self.OBSTACLE_CLASSES:
                self._detection_log.append(
                    {
                        "timestamp": time.time(),
                        "class": d.class_name,
                        "confidence": d.confidence,
                        "distance": d.distance_estimate,
                        "bbox": d.bbox,
                    }
                )

    def get_detection_log(self) -> list[dict]:
        """Return a copy of all logged obstacle detections."""
        return self._detection_log.copy()

    def export_model_onnx(self, output_path: str = "yolov8n.onnx") -> str:
        """Export model to ONNX for TensorRT benchmark (NVIDIA demo).

        Args:
            output_path: Destination path for the ONNX file.

        Returns:
            Path to the exported ONNX file.

        Raises:
            RuntimeError: If no model is loaded (mock mode).
        """
        if self._model is None:
            raise RuntimeError("No model loaded")
        path = self._model.export(format="onnx")
        logger.info(f"Model exported to ONNX: {path}")
        return path

    def benchmark(self, image_frame=None, runs: int = 100) -> dict:
        """Benchmark inference speed for PyTorch vs ONNX comparison.

        Args:
            image_frame: Optional BGR numpy array. If None, a random 480x640 frame is used.
            runs: Number of inference iterations.

        Returns:
            Dict with pytorch_avg_ms, pytorch_min_ms, pytorch_max_ms, and runs.
        """
        import numpy as np

        if image_frame is None:
            image_frame = np.random.randint(
                0, 255, (480, 640, 3), dtype=np.uint8
            )

        # PyTorch inference
        times: list[float] = []
        for _ in range(runs):
            start = time.perf_counter()
            self.detect(image_frame)
            times.append((time.perf_counter() - start) * 1000)

        return {
            "pytorch_avg_ms": sum(times) / len(times),
            "pytorch_min_ms": min(times),
            "pytorch_max_ms": max(times),
            "runs": runs,
        }


# --- Quick test ---
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(message)s",
    )

    print("=== CV Obstacle Detector (mock mode) ===")
    detector = CVObstacleDetector(use_mock=True)

    obstacle_count = 0
    for i in range(20):
        detections = detector.detect(None)
        if detections:
            obstacle_count += 1
            d = detections[0]
            evasion = detector.get_evasion_vector(detections)
            ahead = detector.is_obstacle_ahead(detections)
            print(
                f"  Frame {i:02d}: {d.class_name} "
                f"(conf={d.confidence:.2f}, dist={d.distance_estimate:.1f}m) "
                f"| ahead={ahead} | evasion={evasion}"
            )
        else:
            print(f"  Frame {i:02d}: Clear")

    print(f"\nObstacles detected: {obstacle_count}/20 frames")
    print(f"Detection log entries: {len(detector.get_detection_log())}")

    # Try real model if ultralytics is available
    print("\n=== Attempting real YOLOv8 model ===")
    real_detector = CVObstacleDetector(use_mock=False)
    if real_detector.use_mock:
        print("  ultralytics not available, skipping real model test")
    else:
        print("  Model loaded successfully, running benchmark (10 runs)...")
        stats = real_detector.benchmark(runs=10)
        print(f"  Avg: {stats['pytorch_avg_ms']:.1f}ms")
        print(f"  Min: {stats['pytorch_min_ms']:.1f}ms")
        print(f"  Max: {stats['pytorch_max_ms']:.1f}ms")
