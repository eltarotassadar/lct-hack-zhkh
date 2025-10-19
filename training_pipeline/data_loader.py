"""Helpers for loading telemetry and weather features used in notebooks."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import pandas as pd


def _build_geo_key(lat_series: pd.Series, lon_series: pd.Series, precision: int = 4) -> pd.Series:
    """Construct a stable geographic key from latitude/longitude coordinates."""

    lat = lat_series.round(precision).map(f"{{:.{precision}f}}".format)
    lon = lon_series.round(precision).map(f"{{:.{precision}f}}".format)
    return lat + "_" + lon


def _ensure_geo_key(
    df: pd.DataFrame,
    *,
    lat_cols: Iterable[str],
    lon_cols: Iterable[str],
    key: str = "geo_key",
    precision: int = 4,
) -> pd.DataFrame:
    """Ensure a geographic key exists based on the provided latitude/longitude columns."""

    if key in df.columns:
        return df

    for lat_col in lat_cols:
        for lon_col in lon_cols:
            if lat_col in df.columns and lon_col in df.columns:
                df[key] = _build_geo_key(df[lat_col], df[lon_col], precision=precision)
                return df

    raise ValueError(
        "Could not derive geographic key: none of the provided lat/lon columns are present."
    )


def _load_table(data_dir: Path, stem: str, prefer_parquet: bool = True) -> pd.DataFrame:
    """Load a table from the data directory.

    Parameters
    ----------
    data_dir: Path
        Root directory with prepared datasets.
    stem: str
        Base filename without extension.
    prefer_parquet: bool, default ``True``
        Try to load parquet first (if present), otherwise fallback to CSV.
    """

    data_dir = Path(data_dir)
    candidates = []
    if prefer_parquet:
        candidates.append(data_dir / f"{stem}.parquet")
    candidates.append(data_dir / f"{stem}.csv")
    if not prefer_parquet:
        candidates.append(data_dir / f"{stem}.parquet")

    errors: list[Exception] = []

    for path in candidates:
        if path.exists():
            if path.suffix == ".parquet":
                try:
                    return pd.read_parquet(path)
                except Exception as exc:  # pragma: no cover - optional dependency
                    errors.append(exc)
                    continue
            return pd.read_csv(path)

    raise FileNotFoundError(
        "Could not load '{stem}' dataset in"
        f" {data_dir}. Tried: {candidates}. Errors: {errors}"
    )


def load_telemetry_data(
    data_dir: Optional[Path] = None,
    *,
    prefer_parquet: bool = True,
) -> pd.DataFrame:
    """Load raw telemetry with building, ITP and ODDP identifiers."""

    data_dir = Path(data_dir or "data")
    telemetry = _load_table(data_dir, "telemetry", prefer_parquet=prefer_parquet)
    telemetry["date"] = pd.to_datetime(telemetry["date"])
    required = {"itp_cold_water", "odpu_hot_water"}
    missing = required - set(telemetry.columns)
    if missing:
        raise ValueError(
            "Telemetry dataset must include columns: " + ", ".join(sorted(missing))
        )
    telemetry["deviation_ratio"] = (
        telemetry["itp_cold_water"].astype(float) - telemetry["odpu_hot_water"].astype(float)
    ).abs() / telemetry["itp_cold_water"].replace(0, pd.NA)
    telemetry["deviation_ratio"] = telemetry["deviation_ratio"].fillna(0.0)
    telemetry["anomaly"] = telemetry["deviation_ratio"] > 0.10
    telemetry = _ensure_geo_key(
        telemetry,
        lat_cols=["mkd_lat"],
        lon_cols=["mkd_lon"],
    )
    return telemetry


def load_weather_features(
    data_dir: Optional[Path] = None,
    *,
    prefer_parquet: bool = True,
) -> pd.DataFrame:
    """Load aggregated weather attributes per date and geographic key."""

    data_dir = Path(data_dir or "data")
    weather = _load_table(data_dir, "weather_features", prefer_parquet=prefer_parquet)
    weather["date"] = pd.to_datetime(weather["date"])
    weather = _ensure_geo_key(
        weather,
        lat_cols=["mkd_lat"],
        lon_cols=["mkd_lon"],
    )
    return weather


def prepare_model_frame(
    telemetry: Optional[pd.DataFrame] = None,
    weather: Optional[pd.DataFrame] = None,
    *,
    data_dir: Optional[Path] = None,
    prefer_parquet: bool = True,
) -> pd.DataFrame:
    """Merge telemetry with weather data, ready for feature engineering."""

    if telemetry is None:
        telemetry = load_telemetry_data(data_dir, prefer_parquet=prefer_parquet)
    else:
        telemetry = telemetry.copy()
        telemetry["date"] = pd.to_datetime(telemetry["date"])

    if weather is None:
        weather = load_weather_features(data_dir, prefer_parquet=prefer_parquet)
    else:
        weather = weather.copy()
        weather["date"] = pd.to_datetime(weather["date"])

    required_keys = {"date", "geo_key"}
    missing_keys = required_keys - set(telemetry.columns)
    if missing_keys:
        raise ValueError(
            "Telemetry data is missing required columns: " + ", ".join(sorted(missing_keys))
        )

    missing_keys = required_keys - set(weather.columns)
    if missing_keys:
        raise ValueError(
            "Weather data is missing required columns: " + ", ".join(sorted(missing_keys))
        )

    overlap_columns = (set(telemetry.columns) & set(weather.columns)) - required_keys
    if overlap_columns:
        weather = weather.drop(columns=list(overlap_columns))

    merged = pd.merge(
        telemetry,
        weather,
        on=["date", "geo_key"],
        how="left",
        validate="m:1",
    )

    merged.sort_values(["mkd_id", "date"], inplace=True)
    merged.reset_index(drop=True, inplace=True)
    return merged
