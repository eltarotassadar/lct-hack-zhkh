"""Geo-intelligence helpers for polygon endpoints."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List
from datetime import date, datetime
import logging

import aiohttp
import h3
import pandas as pd

try:  # pragma: no cover - import guard for optional dependency
    from catboost import CatBoostRegressor
except ModuleNotFoundError:  # pragma: no cover - executed only when dependency missing
    CatBoostRegressor = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

# Support both package and script imports
try:  # package import
    from .prepare_weather import aggregate_weather, prepare_agronomic_features
    from .synthetic_geo import generate_synthetic_bundle, generate_synthetic_summary
except Exception:  # script import fallback
    from prepare_weather import (  # type: ignore
        aggregate_weather,
        prepare_agronomic_features,
    )
    from synthetic_geo import generate_synthetic_bundle, generate_synthetic_summary  # type: ignore

ROOT_DIR = Path(__file__).resolve().parents[1]
WEIGHTS_DIR = ROOT_DIR / "backend" / "weights"

MODEL_PATH = WEIGHTS_DIR / "weights.cbm"
EMBEDDINGS_PATH = WEIGHTS_DIR / "embeddings.json"

CATBOOST_COLUMNS = [
    "year",
    "embeddings",
    "avg_day_temp_prorastanie",
    "min_day_temp_prorastanie",
    "max_day_temp_prorastanie",
    "avg_soil_moisture_100_to_255cm_prorastanie",
    "sum_rain_prorastanie",
    "avg_temperature_soil_prorastanie",
    "avg_cloud_cover_high_prorastanie",
    "gtd_prorastanie",
    "avg_day_temp_vshody",
    "min_day_temp_vshody",
    "max_day_temp_vshody",
    "avg_soil_moisture_100_to_255cm_vshody",
    "sum_rain_vshody",
    "avg_temperature_soil_vshody",
    "avg_cloud_cover_high_vshody",
    "gtd_vshody",
    "avg_day_temp_veg_faza",
    "min_day_temp_veg_faza",
    "max_day_temp_veg_faza",
    "avg_soil_moisture_100_to_255cm_veg_faza",
    "sum_rain_veg_faza",
    "avg_temperature_soil_veg_faza",
    "avg_cloud_cover_high_veg_faza",
    "gtd_veg_faza",
    "avg_day_temp_cvetenie",
    "min_day_temp_cvetenie",
    "max_day_temp_cvetenie",
    "avg_soil_moisture_100_to_255cm_cvetenie",
    "sum_rain_cvetenie",
    "avg_temperature_soil_cvetenie",
    "avg_cloud_cover_high_cvetenie",
    "gtd_cvetenie",
    "avg_day_temp_form_bobov",
    "min_day_temp_form_bobov",
    "max_day_temp_form_bobov",
    "avg_soil_moisture_100_to_255cm_form_bobov",
    "sum_rain_form_bobov",
    "avg_temperature_soil_form_bobov",
    "avg_cloud_cover_high_form_bobov",
    "gtd_form_bobov",
    "avg_day_temp_sozrevanie",
    "min_day_temp_sozrevanie",
    "max_day_temp_sozrevanie",
    "avg_soil_moisture_100_to_255cm_sozrevanie",
    "sum_rain_sozrevanie",
    "avg_temperature_soil_sozrevanie",
    "avg_cloud_cover_high_sozrevanie",
    "gtd_sozrevanie",
    "avg_day_temp_ubor_urozhaya",
    "min_day_temp_ubor_urozhaya",
    "max_day_temp_ubor_urozhaya",
    "avg_soil_moisture_100_to_255cm_ubor_urozhaya",
    "sum_rain_ubor_urozhaya",
    "avg_temperature_soil_ubor_urozhaya",
    "avg_cloud_cover_high_ubor_urozhaya",
    "gtd_ubor_urozhaya",
]


@lru_cache(maxsize=1)
def _load_embeddings() -> pd.DataFrame:
    return pd.read_json(EMBEDDINGS_PATH)


@lru_cache(maxsize=1)
def _load_model() -> CatBoostRegressor | None:
    if CatBoostRegressor is None:
        logger.warning(
            "CatBoost dependency is not installed; falling back to synthetic predictions."
        )
        return None

    model = CatBoostRegressor()
    model.load_model(str(MODEL_PATH))
    return model


async def predict_yield(year: int, raw_weather: dict) -> list[dict]:
    """Return CatBoost yield rankings merged with agronomic weather features."""

    model = _load_model()
    if model is None:
        return []
    embeddings = _load_embeddings().copy()
    embeddings["year"] = year

    features = await prepare_agronomic_features(raw_weather)
    if features.empty:
        return []

    merged = embeddings.merge(features, on="year", how="left")
    data = merged.drop(columns=["sample"], errors="ignore")
    for column in CATBOOST_COLUMNS:
        if column not in data:
            data[column] = 0.0
    data = data[CATBOOST_COLUMNS]

    predictions = model.predict(data)
    result = []
    for index, score in enumerate(predictions):
        sample = embeddings.at[index, "sample"] if "sample" in embeddings.columns else f"NODE-{index}"
        result.append({"sample": sample, "yield": float(score)})
    result.sort(key=lambda item: item["yield"], reverse=True)
    return result


async def enrich_polygon(cell_id: str, epoch_seconds: int, year_override: int | None = None) -> dict:
    """Fetch polygon metadata, weather aggregates, and CatBoost ranking."""

    center_lat, center_lon = h3.cell_to_latlng(cell_id)
    boundary = h3.cell_to_boundary(cell_id)

    year = year_override or datetime.utcfromtimestamp(epoch_seconds).year
    start_date = date(year, 5, 1)
    end_date = date(year, 10, 1)

    params = {
        "latitude": center_lat,
        "longitude": center_lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "rain",
            "cloud_cover_high",
            "soil_moisture_100_to_255cm",
            "soil_temperature_100_to_255cm",
        ],
        "timezone": "Europe/Moscow",
        "models": "best_match",
    }

    fallback = generate_synthetic_bundle(cell_id, year)
    weather = fallback["weather"]
    predictions = fallback["yieldPrediction"]
    summary = fallback["summary"]
    dataset = summary.get("dataset", "synthetic")

    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            resp = await session.get("https://archive-api.open-meteo.com/v1/archive", params=params)
            resp.raise_for_status()
            payload = await resp.json()

        weather_api = await aggregate_weather(payload)
        if weather_api:
            weather = weather_api
            dataset = "open-meteo"

        try:
            predictions_api = await predict_yield(year, payload)
        except Exception:
            predictions_api = []

        if predictions_api:
            predictions = predictions_api
    except Exception:
        pass

    scores: list[float] = []
    for item in predictions:
        value = None
        if isinstance(item, dict):
            for key in ("yield", "riskScore", "value"):
                if isinstance(item.get(key), (int, float)):
                    value = float(item[key])
                    break
        if value is not None:
            scores.append(value)

    summary_out = dict(summary)
    if scores:
        summary_out["riskIndex"] = round(sum(scores) / len(scores), 2)
        summary_out["maxRisk"] = round(max(scores), 2)
    summary_out["dataset"] = dataset
    summary_out["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    return {
        "cellId": cell_id,
        "center": [center_lat, center_lon],
        "boundary": boundary,
        "weather": weather,
        "yieldPrediction": predictions,
        "summary": summary_out,
        "dataset": dataset,
    }


async def resolve_polygons(ids: List[str], year: int | None = None) -> list[dict]:
    """Return minimal polygon descriptors for a list of H3 cells."""

    polygons = []
    resolved_year = year or datetime.utcnow().year
    for cell in ids:
        summary = generate_synthetic_summary(cell, resolved_year)
        polygons.append(
            {
                "cellId": cell,
                "center": h3.cell_to_latlng(cell),
                "boundary": h3.cell_to_boundary(cell),
                "riskIndex": summary["riskIndex"],
                "maxRisk": summary["maxRisk"],
                "leakProbability": summary["leakProbability"],
                "flowRate": summary["flowRate"],
                "pressure": summary["pressure"],
                "status": summary["status"],
                "dataset": summary["dataset"],
                "updatedAt": summary["updatedAt"],
                "advisories": summary["advisories"],
                "districtKey": summary.get("districtKey"),
                "districtLabel": summary.get("districtLabel"),
            }
        )
    return polygons
