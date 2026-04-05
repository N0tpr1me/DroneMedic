"""DroneMedic - Predictive Maintenance via Telemetry Anomaly Detection.

Two-tier approach:
  Tier 1 -- Z-score statistical anomaly detection (always available).
  Tier 2 -- PyTorch LSTM Autoencoder (when torch is installed).

Usage:
    from ai.predictive_maintenance import MaintenancePredictor

    predictor = MaintenancePredictor()
    result = predictor.predict("Drone1", telemetry_list)
"""

from __future__ import annotations

import logging
import math
import statistics
from pathlib import Path
from typing import Any

from config import (
    BATTERY_DRAIN_RATE_BASE,
    BATTERY_DRAIN_RATE_PER_KG,
    DRONE_EMPTY_WEIGHT_KG,
    DRONE_MAX_PAYLOAD_KG,
)

logger = logging.getLogger("DroneMedic.Maintenance")

# ---------------------------------------------------------------------------
# Try importing PyTorch -- gracefully degrade to Tier 1 only when absent.
# ---------------------------------------------------------------------------

_TORCH_AVAILABLE = False
try:
    import torch
    import torch.nn as nn

    _TORCH_AVAILABLE = True
except ImportError:
    torch = None  # type: ignore[assignment]
    nn = None  # type: ignore[assignment]

# Saved-model path
_MODEL_DIR = Path(__file__).parent / "models"
_MODEL_PATH = _MODEL_DIR / "maintenance_lstm.pt"

# Telemetry feature order: battery, speed, altitude, lat, lon
_INPUT_DIM = 5
_HIDDEN_DIM = 32
_NUM_LAYERS = 1
_DEFAULT_SEQ_LEN = 50


# ═══════════════════════════════════════════════════════════════════════════
# Tier 2 -- LSTM Autoencoder
# ═══════════════════════════════════════════════════════════════════════════

if _TORCH_AVAILABLE:

    class TelemetryAutoencoder(nn.Module):
        """LSTM autoencoder trained on *normal* telemetry.

        Anomalies produce high reconstruction error.
        """

        def __init__(
            self,
            input_dim: int = _INPUT_DIM,
            hidden_dim: int = _HIDDEN_DIM,
            num_layers: int = _NUM_LAYERS,
        ) -> None:
            super().__init__()
            self.encoder = nn.LSTM(input_dim, hidden_dim, num_layers, batch_first=True)
            self.decoder = nn.LSTM(hidden_dim, input_dim, num_layers, batch_first=True)
            self.hidden_dim = hidden_dim

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            """Encode then decode -- return reconstructed sequence.

            Args:
                x: (batch, seq_len, input_dim)

            Returns:
                Reconstructed tensor of same shape.
            """
            _, (h, _c) = self.encoder(x)
            seq_len = x.size(1)
            decoder_input = h.permute(1, 0, 2).repeat(1, seq_len, 1)
            decoded, _ = self.decoder(decoder_input)
            return decoded

else:
    TelemetryAutoencoder = None  # type: ignore[assignment, misc]


# ═══════════════════════════════════════════════════════════════════════════
# MaintenancePredictor
# ═══════════════════════════════════════════════════════════════════════════


class MaintenancePredictor:
    """Two-tier predictive maintenance predictor."""

    def __init__(self, threshold: float = 0.1) -> None:
        self.model: Any | None = None
        self.threshold = threshold
        self._try_load_model()

    # ------------------------------------------------------------------
    # Model lifecycle
    # ------------------------------------------------------------------

    def _try_load_model(self) -> None:
        """Instantiate the LSTM autoencoder and optionally load saved weights."""
        if not _TORCH_AVAILABLE or TelemetryAutoencoder is None:
            logger.info("PyTorch not available -- using Tier 1 (Z-score) only")
            return
        try:
            self.model = TelemetryAutoencoder()
            if _MODEL_PATH.exists():
                self.model.load_state_dict(
                    torch.load(_MODEL_PATH, map_location="cpu", weights_only=True)
                )
                logger.info("Loaded pre-trained maintenance LSTM from %s", _MODEL_PATH)
            else:
                logger.info("No saved weights found -- LSTM initialised with random weights")
            self.model.eval()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to initialise LSTM model: %s", exc)
            self.model = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict(self, drone_id: str, telemetry: list[dict]) -> dict:
        """Analyse telemetry for maintenance anomalies.

        Args:
            drone_id: Identifier of the drone.
            telemetry: List of telemetry dicts (must include at least
                       ``battery``; optionally ``speed``, ``altitude``,
                       ``position.lat``, ``position.lon``).

        Returns:
            Dict with risk_score (0-100), anomaly flag, and recommendation.
        """
        if not telemetry:
            return {
                "drone_id": drone_id,
                "risk_score": 0,
                "anomaly": False,
                "zscore_analysis": None,
                "lstm_analysis": None,
                "recommendation": "No telemetry data",
                "details": {"telemetry_points_analyzed": 0, "model_type": "none"},
            }

        zscore_result = self._zscore_analysis(telemetry)

        lstm_result: dict | None = None
        if self.model is not None:
            lstm_result = self._lstm_analysis(telemetry)

        # LSTM takes priority when available; fall back to Z-score.
        risk_score = lstm_result["risk_score"] if lstm_result else zscore_result["risk_score"]
        anomaly = risk_score > 60

        return {
            "drone_id": drone_id,
            "risk_score": round(risk_score, 1),
            "anomaly": anomaly,
            "zscore_analysis": zscore_result,
            "lstm_analysis": lstm_result,
            "recommendation": self._get_recommendation(risk_score),
            "details": {
                "telemetry_points_analyzed": len(telemetry),
                "model_type": "lstm_autoencoder" if lstm_result else "zscore",
            },
        }

    # ------------------------------------------------------------------
    # Tier 1 -- Z-score battery drain analysis
    # ------------------------------------------------------------------

    def _zscore_analysis(self, telemetry: list[dict]) -> dict:
        """Statistical anomaly detection on battery drain rate.

        Compares actual battery drain between consecutive snapshots against
        the physics-based expected drain from config.py constants.
        """
        if len(telemetry) < 2:
            return {"risk_score": 0, "drain_ratio": 0, "expected_drain": 0, "actual_drain": 0}

        # Compute actual drain across the telemetry window
        first_battery = telemetry[0].get("battery", 100.0)
        last_battery = telemetry[-1].get("battery", 100.0)
        actual_drain = first_battery - last_battery

        # Estimate distance from positions (Euclidean on x/y)
        total_distance = 0.0
        for i in range(1, len(telemetry)):
            pos_prev = telemetry[i - 1].get("position", {})
            pos_curr = telemetry[i].get("position", {})
            dx = pos_curr.get("x", 0) - pos_prev.get("x", 0)
            dy = pos_curr.get("y", 0) - pos_prev.get("y", 0)
            dz = pos_curr.get("z", 0) - pos_prev.get("z", 0)
            total_distance += math.sqrt(dx * dx + dy * dy + dz * dz)

        # Expected drain using config physics constants
        avg_payload_kg = DRONE_MAX_PAYLOAD_KG * 0.5  # assume 50% average load
        expected_drain = (
            BATTERY_DRAIN_RATE_BASE * total_distance
            + BATTERY_DRAIN_RATE_PER_KG * avg_payload_kg * total_distance
        )

        if expected_drain <= 0:
            drain_ratio = 0.0
        else:
            drain_ratio = actual_drain / expected_drain

        # Risk score: ratio of 1.0 = nominal, 2.0+ = anomalous
        # Map drain_ratio to 0-100 risk score
        if drain_ratio <= 1.0:
            risk_score = drain_ratio * 20  # 0-20 for normal
        elif drain_ratio <= 2.0:
            risk_score = 20 + (drain_ratio - 1.0) * 40  # 20-60 for elevated
        else:
            risk_score = min(60 + (drain_ratio - 2.0) * 20, 100)  # 60-100 for anomalous

        return {
            "risk_score": round(risk_score, 1),
            "drain_ratio": round(drain_ratio, 3),
            "expected_drain": round(expected_drain, 2),
            "actual_drain": round(actual_drain, 2),
            "distance_m": round(total_distance, 1),
            "flagged": drain_ratio > 2.0,
        }

    # ------------------------------------------------------------------
    # Tier 2 -- LSTM autoencoder reconstruction error
    # ------------------------------------------------------------------

    def _lstm_analysis(self, telemetry: list[dict]) -> dict | None:
        """Run telemetry through LSTM autoencoder and score reconstruction error."""
        if self.model is None or not _TORCH_AVAILABLE:
            return None

        tensor = self._telemetry_to_tensor(telemetry)
        if tensor is None:
            return None

        with torch.no_grad():
            reconstructed = self.model(tensor)
            mse = torch.mean((tensor - reconstructed) ** 2).item()

        # Map reconstruction error to 0-100 risk score
        # Threshold calibrated during training; default 0.1
        risk_score = min((mse / self.threshold) * 50, 100)

        return {
            "risk_score": round(risk_score, 1),
            "reconstruction_error": round(mse, 6),
            "threshold": self.threshold,
            "above_threshold": mse > self.threshold,
        }

    # ------------------------------------------------------------------
    # Tensor conversion
    # ------------------------------------------------------------------

    @staticmethod
    def _telemetry_to_tensor(telemetry: list[dict]) -> torch.Tensor | None:
        """Convert list of telemetry dicts to a (1, seq_len, 5) tensor.

        Features: [battery, speed, altitude, lat, lon]
        Values are min-max normalised to [0, 1].
        """
        if not _TORCH_AVAILABLE:
            return None

        rows: list[list[float]] = []
        for t in telemetry:
            pos = t.get("position", {})
            rows.append([
                t.get("battery", 100.0) / 100.0,
                t.get("speed", 0.0) / 30.0,       # normalise by max cruise
                t.get("altitude", 0.0) / 120.0,    # normalise by max altitude
                pos.get("lat", 0.0) / 90.0,
                pos.get("lon", 0.0) / 180.0,
            ])

        if not rows:
            return None

        tensor = torch.tensor([rows], dtype=torch.float32)  # (1, seq_len, 5)
        return tensor

    # ------------------------------------------------------------------
    # Recommendation
    # ------------------------------------------------------------------

    @staticmethod
    def _get_recommendation(risk_score: float) -> str:
        if risk_score > 80:
            return "URGENT: Schedule immediate maintenance inspection"
        if risk_score > 60:
            return "WARNING: Schedule maintenance within 3 days"
        if risk_score > 40:
            return "MONITOR: Elevated readings -- inspect at next scheduled maintenance"
        return "NOMINAL: All systems within expected parameters"

    # ------------------------------------------------------------------
    # Synthetic data generation
    # ------------------------------------------------------------------

    def generate_synthetic_training_data(
        self,
        n_samples: int = 1000,
        seq_len: int = _DEFAULT_SEQ_LEN,
    ) -> torch.Tensor:
        """Generate synthetic *normal* telemetry for autoencoder training.

        Each sample simulates a nominal flight: battery drains linearly,
        speed hovers around cruise, altitude is stable, lat/lon drift
        slowly along a straight path.

        Returns:
            Tensor of shape (n_samples, seq_len, 5).
        """
        if not _TORCH_AVAILABLE:
            raise RuntimeError("PyTorch is required for training data generation")

        data = torch.zeros(n_samples, seq_len, _INPUT_DIM)

        for i in range(n_samples):
            # Randomise starting conditions
            start_battery = 0.8 + 0.2 * torch.rand(1).item()        # 80-100%
            drain_per_step = (0.005 + 0.01 * torch.rand(1).item())   # per step
            base_speed = 0.4 + 0.2 * torch.rand(1).item()            # normalised
            base_alt = 0.5 + 0.2 * torch.rand(1).item()              # normalised
            start_lat = 0.55 + 0.05 * torch.rand(1).item()           # ~51 deg normalised
            start_lon = -0.001 + 0.002 * torch.rand(1).item()
            lat_drift = 0.0001 * (torch.rand(1).item() - 0.5)
            lon_drift = 0.0001 * (torch.rand(1).item() - 0.5)

            for t in range(seq_len):
                noise = 0.01 * torch.randn(_INPUT_DIM)
                battery = max(start_battery - drain_per_step * t, 0.0)
                speed = base_speed + noise[1].item()
                alt = base_alt + noise[2].item()
                lat = start_lat + lat_drift * t + noise[3].item() * 0.001
                lon = start_lon + lon_drift * t + noise[4].item() * 0.001

                data[i, t] = torch.tensor([battery, speed, alt, lat, lon])

        return data

    # ------------------------------------------------------------------
    # Training loop
    # ------------------------------------------------------------------

    def train(
        self,
        normal_data: torch.Tensor,
        epochs: int = 50,
        lr: float = 0.001,
        batch_size: int = 32,
    ) -> list[float]:
        """Train the autoencoder on normal telemetry data.

        Args:
            normal_data: (n_samples, seq_len, input_dim) tensor of
                         nominal telemetry.
            epochs: Training epochs.
            lr: Learning rate.
            batch_size: Mini-batch size.

        Returns:
            List of per-epoch average losses.
        """
        if not _TORCH_AVAILABLE or self.model is None:
            raise RuntimeError("PyTorch and a loaded model are required for training")

        self.model.train()
        optimiser = torch.optim.Adam(self.model.parameters(), lr=lr)
        criterion = nn.MSELoss()

        n_samples = normal_data.size(0)
        epoch_losses: list[float] = []

        for epoch in range(epochs):
            # Shuffle
            perm = torch.randperm(n_samples)
            running_loss = 0.0
            n_batches = 0

            for start in range(0, n_samples, batch_size):
                batch_idx = perm[start : start + batch_size]
                batch = normal_data[batch_idx]

                reconstructed = self.model(batch)
                loss = criterion(reconstructed, batch)

                optimiser.zero_grad()
                loss.backward()
                optimiser.step()

                running_loss += loss.item()
                n_batches += 1

            avg_loss = running_loss / max(n_batches, 1)
            epoch_losses.append(avg_loss)

            if (epoch + 1) % 10 == 0 or epoch == 0:
                logger.info("Epoch %3d/%d  loss=%.6f", epoch + 1, epochs, avg_loss)

        # Calibrate threshold as 2x the final average loss
        self.threshold = avg_loss * 2.0
        self.model.eval()
        logger.info(
            "Training complete. Final loss=%.6f  threshold=%.6f",
            avg_loss,
            self.threshold,
        )
        return epoch_losses

    def save_model(self, path: Path | None = None) -> Path:
        """Persist model weights to disk."""
        if not _TORCH_AVAILABLE or self.model is None:
            raise RuntimeError("No model to save")

        save_path = path or _MODEL_PATH
        save_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(self.model.state_dict(), save_path)
        logger.info("Model saved to %s", save_path)
        return save_path


# ═══════════════════════════════════════════════════════════════════════════
# CLI training script
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    predictor = MaintenancePredictor()

    if not _TORCH_AVAILABLE:
        print("ERROR: PyTorch is required for training. Install with: pip install torch")
        raise SystemExit(1)

    print("Generating synthetic training data...")
    x_train = predictor.generate_synthetic_training_data(n_samples=1000, seq_len=50)
    print(f"  Shape: {x_train.shape}")

    print("\nTraining LSTM autoencoder...")
    losses = predictor.train(x_train, epochs=50, lr=0.001)

    print(f"\nSaving model to {_MODEL_PATH}...")
    predictor.save_model()
    print("Done.")

    # Quick sanity check with synthetic anomalous data
    print("\n--- Sanity Check ---")
    normal_telemetry = [
        {"battery": 100 - i * 0.5, "speed": 15.0, "altitude": 80.0,
         "position": {"x": i * 10.0, "y": 0.0, "z": -30.0, "lat": 51.507 + i * 0.001, "lon": -0.127}}
        for i in range(20)
    ]
    result_normal = predictor.predict("Drone1", normal_telemetry)
    print(f"Normal flight  -> risk={result_normal['risk_score']}, anomaly={result_normal['anomaly']}")

    anomalous_telemetry = [
        {"battery": 100 - i * 5.0, "speed": 5.0, "altitude": 20.0,
         "position": {"x": i * 10.0, "y": 0.0, "z": -30.0, "lat": 51.507 + i * 0.001, "lon": -0.127}}
        for i in range(20)
    ]
    result_anomalous = predictor.predict("Drone1", anomalous_telemetry)
    print(f"Anomalous data -> risk={result_anomalous['risk_score']}, anomaly={result_anomalous['anomaly']}")
