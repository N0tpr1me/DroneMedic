"""
Predictive demand model using Meta Prophet for medical emergency forecasting.

Trains one Prophet model per location on synthetic emergency data, then predicts
future hourly demand. Supports heatmap export for the dashboard map layer.

Falls back gracefully when Prophet is not installed.
"""

import logging
import os
import pickle
from typing import Optional

logger = logging.getLogger(__name__)

# Guard against missing Prophet
try:
    from prophet import Prophet
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False
    logger.warning(
        "Prophet not installed. Install with: pip install prophet. "
        "DemandPredictor will operate in fallback mode."
    )

try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    logger.warning("pandas not installed. DemandPredictor requires pandas.")


# Location coordinates for heatmap (mirrors config.py)
_LOCATION_COORDS = {
    "Depot":    {"lat": 51.5074, "lon": -0.1278},
    "Clinic A": {"lat": 51.5124, "lon": -0.1200},
    "Clinic B": {"lat": 51.5174, "lon": -0.1350},
    "Clinic C": {"lat": 51.5044, "lon": -0.1100},
    "Clinic D": {"lat": 51.5000, "lon": -0.1400},
}


class DemandPredictor:
    """Trains and serves per-location Prophet demand forecasts."""

    def __init__(self, model_dir: str = "models") -> None:
        self._models: dict = {}  # location_id -> trained Prophet model
        self._model_dir: str = model_dir

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(self, data_path: str = "data/synthetic_emergencies.csv") -> None:
        """Train one Prophet model per location on hourly demand counts."""
        if not PROPHET_AVAILABLE:
            raise ImportError(
                "Prophet is required for training. Install with: pip install prophet"
            )
        if not PANDAS_AVAILABLE:
            raise ImportError("pandas is required. Install with: pip install pandas")

        df = pd.read_csv(data_path, parse_dates=["timestamp"])
        logger.info("Loaded %d records from %s", len(df), data_path)

        for loc_id in sorted(df["location_id"].unique()):
            logger.info("Training model for %s ...", loc_id)
            loc_df = df[df["location_id"] == loc_id].copy()

            # Floor timestamps to the hour
            loc_df["hour_bucket"] = loc_df["timestamp"].dt.floor("h")

            # Hourly demand count
            hourly = (
                loc_df.groupby("hour_bucket")
                .size()
                .reset_index(name="y")
                .rename(columns={"hour_bucket": "ds"})
            )

            # Temperature regressor: mean temperature per hour bucket
            temp_hourly = (
                loc_df.groupby("hour_bucket")["temperature_c"]
                .mean()
                .reset_index()
                .rename(columns={"hour_bucket": "ds", "temperature_c": "temperature"})
            )
            hourly = hourly.merge(temp_hourly, on="ds", how="left")
            hourly["temperature"] = hourly["temperature"].fillna(
                hourly["temperature"].median()
            )

            # Fill gaps in the time series with zero demand
            full_range = pd.date_range(
                start=hourly["ds"].min(),
                end=hourly["ds"].max(),
                freq="h",
            )
            hourly = (
                hourly.set_index("ds")
                .reindex(full_range)
                .fillna({"y": 0})
                .reset_index()
                .rename(columns={"index": "ds"})
            )
            hourly["temperature"] = hourly["temperature"].ffill().bfill().fillna(15.0)

            model = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=True,
                daily_seasonality=True,
                changepoint_prior_scale=0.05,
            )
            model.add_regressor("temperature")

            # Suppress Prophet's verbose stdout
            import io
            import sys
            old_stdout = sys.stdout
            sys.stdout = io.StringIO()
            try:
                model.fit(hourly)
            finally:
                sys.stdout = old_stdout

            self._models[loc_id] = model
            logger.info("Trained model for %s (%d hourly rows)", loc_id, len(hourly))

        logger.info("Training complete: %d models", len(self._models))

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------

    def predict(
        self,
        hours_ahead: int = 48,
        temperature_future: Optional[float] = None,
    ) -> dict:
        """Predict demand for next N hours per location.

        Args:
            hours_ahead: Number of hours to forecast.
            temperature_future: Assumed future temperature (Celsius).
                                Defaults to 15.0 if not provided.

        Returns:
            {location_id: [{"ds": datetime, "yhat": float,
                            "yhat_lower": float, "yhat_upper": float}, ...]}
        """
        if not self._models:
            raise RuntimeError(
                "No trained models. Call train() or load_models() first."
            )
        if not PANDAS_AVAILABLE:
            raise ImportError("pandas is required for prediction.")

        temp = temperature_future if temperature_future is not None else 15.0
        results: dict = {}

        for loc_id, model in self._models.items():
            future = model.make_future_dataframe(periods=hours_ahead, freq="h")
            future["temperature"] = temp

            forecast = model.predict(future)
            # Take only the future portion
            future_forecast = forecast.tail(hours_ahead)

            predictions = []
            for _, row in future_forecast.iterrows():
                predictions.append({
                    "ds": row["ds"],
                    "yhat": max(0.0, round(row["yhat"], 3)),
                    "yhat_lower": max(0.0, round(row["yhat_lower"], 3)),
                    "yhat_upper": max(0.0, round(row["yhat_upper"], 3)),
                })

            results[loc_id] = predictions

        return results

    def get_heatmap_data(
        self,
        hours_ahead: int = 2,
        temperature_future: Optional[float] = None,
    ) -> list[dict]:
        """Get predicted demand as heatmap points for the next N hours.

        Returns:
            [{"lat": float, "lon": float, "weight": float, "location_id": str}, ...]
        """
        predictions = self.predict(
            hours_ahead=hours_ahead,
            temperature_future=temperature_future,
        )

        heatmap_points: list[dict] = []

        for loc_id, preds in predictions.items():
            coords = _LOCATION_COORDS.get(loc_id)
            if coords is None:
                logger.warning("Unknown location %s, skipping heatmap point", loc_id)
                continue

            # Sum predicted demand over the forecast window
            total_demand = sum(p["yhat"] for p in preds)

            heatmap_points.append({
                "lat": coords["lat"],
                "lon": coords["lon"],
                "weight": round(total_demand, 3),
                "location_id": loc_id,
            })

        # Sort by weight descending for easy top-N access
        heatmap_points.sort(key=lambda p: p["weight"], reverse=True)
        return heatmap_points

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save_models(self) -> None:
        """Serialize trained models to disk."""
        os.makedirs(self._model_dir, exist_ok=True)
        for loc_id, model in self._models.items():
            safe_name = loc_id.replace(" ", "_").lower()
            path = os.path.join(self._model_dir, f"prophet_{safe_name}.pkl")
            with open(path, "wb") as f:
                pickle.dump(model, f)
            logger.info("Saved model for %s -> %s", loc_id, path)

    def load_models(self) -> None:
        """Load previously saved models from disk."""
        if not os.path.isdir(self._model_dir):
            raise FileNotFoundError(f"Model directory not found: {self._model_dir}")

        loaded = 0
        for fname in sorted(os.listdir(self._model_dir)):
            if fname.startswith("prophet_") and fname.endswith(".pkl"):
                path = os.path.join(self._model_dir, fname)
                with open(path, "rb") as f:
                    model = pickle.load(f)

                # Reconstruct location_id from filename
                loc_key = (
                    fname.replace("prophet_", "")
                    .replace(".pkl", "")
                    .replace("_", " ")
                    .title()
                )
                self._models[loc_key] = model
                loaded += 1
                logger.info("Loaded model for %s from %s", loc_key, path)

        if loaded == 0:
            raise FileNotFoundError(
                f"No Prophet model files found in {self._model_dir}"
            )
        logger.info("Loaded %d models", loaded)

    @property
    def trained_locations(self) -> list[str]:
        """Return list of locations with trained models."""
        return list(self._models.keys())


# ======================================================================
# Main — train, predict, and show results
# ======================================================================

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    data_path = "data/synthetic_emergencies.csv"
    if not os.path.exists(data_path):
        print(f"Data file not found: {data_path}")
        print("Run scripts/generate_synthetic_data.py first.")
        sys.exit(1)

    if not PROPHET_AVAILABLE:
        print("Prophet is not installed. Install with: pip install prophet")
        print("Exiting.")
        sys.exit(1)

    predictor = DemandPredictor()

    print("Training models (this may take a few minutes) ...")
    predictor.train(data_path)

    print("\nSaving models ...")
    predictor.save_models()

    print("\nPredicting demand for next 6 hours ...")
    predictions = predictor.predict(hours_ahead=6)

    for loc_id, preds in predictions.items():
        print(f"\n  {loc_id}:")
        for p in preds[:3]:  # Show first 3 hours
            print(
                f"    {p['ds']}  demand={p['yhat']:.2f}  "
                f"[{p['yhat_lower']:.2f}, {p['yhat_upper']:.2f}]"
            )
        if len(preds) > 3:
            print(f"    ... ({len(preds) - 3} more)")

    print("\nHeatmap data (next 2 hours):")
    heatmap = predictor.get_heatmap_data(hours_ahead=2)
    for point in heatmap:
        print(
            f"  {point['location_id']:<12s}  "
            f"({point['lat']:.4f}, {point['lon']:.4f})  "
            f"weight={point['weight']:.3f}"
        )
