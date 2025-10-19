"""Weather aggregation utilities tailored for water-supply monitoring."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

import pandas as pd

SEASON_WINDOWS = {
    "heating_peak": ("01-01", "03-31"),
    "spring_transition": ("04-01", "05-15"),
    "summer_load": ("05-16", "08-31"),
    "autumn_transition": ("09-01", "10-31"),
    "winter_preparation": ("11-01", "12-31"),
}

HOURLY_VARIABLES: tuple[str, ...] = (
    "temperature_2m",
    "relative_humidity_2m",
    "rain",
    "cloud_cover_high",
    "soil_moisture_100_to_255cm",
    "soil_temperature_100_to_255cm",
)

AGRONOMIC_WINDOWS = {
    "prorastanie": ("05-01", "05-14"),
    "vshody": ("05-15", "05-28"),
    "veg_faza": ("05-29", "06-11"),
    "cvetenie": ("06-12", "06-25"),
    "form_bobov": ("06-26", "07-09"),
    "sozrevanie": ("07-10", "07-23"),
    "ubor_urozhaya": ("07-24", "09-20"),
}


def _to_dataframe(raw_weather: dict) -> pd.DataFrame:
    hourly = raw_weather.get("hourly", {})
    if not hourly:
        return pd.DataFrame(columns=["date"] + list(HOURLY_VARIABLES))

    time_index = pd.to_datetime(hourly.get("time", []), utc=True)
    frame = {"date": time_index}
    for variable in HOURLY_VARIABLES:
        frame[variable] = hourly.get(variable, [])
    df = pd.DataFrame(frame)
    df["date"] = df["date"].dt.tz_convert("Europe/Moscow").dt.tz_localize(None)
    return df


def _seasonal_summary(df: pd.DataFrame) -> dict:
    if df.empty:
        return {season: {} for season in SEASON_WINDOWS}

    stats: dict[str, dict[str, float]] = defaultdict(dict)

    df["day"] = df["date"].dt.date
    daily = df.groupby("day").agg({
        "temperature_2m": "mean",
        "relative_humidity_2m": "mean",
        "rain": "sum",
        "cloud_cover_high": "mean",
        "soil_moisture_100_to_255cm": "mean",
        "soil_temperature_100_to_255cm": "mean",
    })

    for season, (start_suffix, end_suffix) in SEASON_WINDOWS.items():
        seasonal_rows = []
        for year in sorted({d.year for d in daily.index}):
            start = pd.to_datetime(f"{year}-{start_suffix}")
            end = pd.to_datetime(f"{year}-{end_suffix}")
            mask = (daily.index >= start) & (daily.index <= end)
            window = daily.loc[mask]
            if window.empty:
                continue
            seasonal_rows.append({
                "year": year,
                "avg_air_temp": float(window["temperature_2m"].mean()),
                "max_air_temp": float(window["temperature_2m"].max()),
                "min_air_temp": float(window["temperature_2m"].min()),
                "avg_humidity": float(window["relative_humidity_2m"].mean()),
                "total_precipitation": float(window["rain"].sum()),
                "avg_cloud_cover": float(window["cloud_cover_high"].mean()),
                "avg_soil_temp": float(window["soil_temperature_100_to_255cm"].mean()),
                "avg_soil_moisture": float(window["soil_moisture_100_to_255cm"].mean()),
            })
        stats[season] = seasonal_rows

    return stats


async def aggregate_weather(raw_weather: dict) -> dict:
    df = _to_dataframe(raw_weather)
    if df.empty:
        return {}

    df["day"] = df["date"].dt.date
    daily = df.groupby("day").agg({
        "temperature_2m": "mean",
        "relative_humidity_2m": "mean",
        "rain": "sum",
        "cloud_cover_high": "mean",
        "soil_moisture_100_to_255cm": "mean",
        "soil_temperature_100_to_255cm": "mean",
    })

    result = {
        "time": [datetime.combine(idx, datetime.min.time()).isoformat() for idx in daily.index],
        "temperature_2m": daily["temperature_2m"].round(2).tolist(),
        "relative_humidity_2m": daily["relative_humidity_2m"].round(2).tolist(),
        "rain": daily["rain"].round(2).tolist(),
        "cloud_cover_high": daily["cloud_cover_high"].round(2).tolist(),
        "soil_moisture_100_to_255cm": daily["soil_moisture_100_to_255cm"].round(2).tolist(),
        "soil_temperature_100_to_255cm": daily["soil_temperature_100_to_255cm"].round(2).tolist(),
        "seasonal": _seasonal_summary(df),
        "avgTemperature": float(daily["temperature_2m"].mean()),
        "avgCloudiness": float(daily["cloud_cover_high"].mean()),
        "totalRain": float(daily["rain"].sum()),
    }

    return result


async def prepare_agronomic_features(raw_weather: dict) -> pd.DataFrame:
    """Aggregate Open-Meteo hourly data into seasonal features for CatBoost."""

    hourly = raw_weather.get("hourly", {})
    time_index = pd.to_datetime(hourly.get("time", []))

    if time_index.empty:
        return pd.DataFrame()

    variables = [
        "temperature_2m",
        "rain",
        "cloud_cover_high",
        "soil_temperature_100_to_255cm",
        "soil_moisture_100_to_255cm",
    ]

    frame = {"date": time_index}
    for var in variables:
        frame[var] = hourly.get(var, [])

    meteo = pd.DataFrame(frame)
    meteo["date"] = meteo["date"].dt.tz_localize(None)

    result = pd.DataFrame()

    for year in sorted(meteo["date"].dt.year.unique()):
        year_data = meteo[meteo["date"].dt.year == year]
        stats: dict[str, float] = {"year": year}

        for window_name, (start_suffix, end_suffix) in AGRONOMIC_WINDOWS.items():
            start = pd.to_datetime(f"{year}-{start_suffix}")
            end = pd.to_datetime(f"{year}-{end_suffix}")
            season = year_data[(year_data["date"] >= start) & (year_data["date"] <= end)]

            if season.empty:
                continue

            stats[f"avg_day_temp_{window_name}"] = float(season["temperature_2m"].mean())
            stats[f"min_day_temp_{window_name}"] = float(season["temperature_2m"].min())
            stats[f"max_day_temp_{window_name}"] = float(season["temperature_2m"].max())
            stats[f"avg_soil_moisture_100_to_255cm_{window_name}"] = float(
                season["soil_moisture_100_to_255cm"].mean()
            )
            stats[f"sum_rain_{window_name}"] = float(season["rain"].sum())
            stats[f"avg_temperature_soil_{window_name}"] = float(
                season["soil_temperature_100_to_255cm"].mean()
            )
            stats[f"avg_cloud_cover_high_{window_name}"] = float(season["cloud_cover_high"].mean())

            above_ten = season.query("temperature_2m > 10")["temperature_2m"].sum()
            total_precip = season["rain"].sum()
            stats[f"gtd_{window_name}"] = float(
                total_precip / (0.1 * above_ten) if above_ten else 0
            )

        result = pd.concat([result, pd.DataFrame([stats])], ignore_index=True)

    return result
