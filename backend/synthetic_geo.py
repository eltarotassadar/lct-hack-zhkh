"""Deterministic synthetic helpers for Geo analytics fallback."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import math
import random
from statistics import mean
from typing import List

# Support both package and script imports
try:  # package
    from .prepare_weather import SEASON_WINDOWS
    from .territories import DISTRICT_LOOKUP
except Exception:  # script fallback
    from prepare_weather import SEASON_WINDOWS  # type: ignore
    from territories import DISTRICT_LOOKUP  # type: ignore


@dataclass
class SyntheticRandom:
    seed: int

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def uniform(self, low: float, high: float) -> float:
        return self._rng.uniform(low, high)

    def normalised(self) -> float:
        return self._rng.random()

    def choice(self, items: List[str]) -> str:
        return self._rng.choice(items)


def _seed(cell_id: str, year: int) -> int:
    digest = hashlib.sha1(f"{cell_id}-{year}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _status_from_risk(risk_index: float) -> str:
    if risk_index > 135:
        return "critical"
    if risk_index >= 115:
        return "alert"
    if risk_index >= 100:
        return "watch"
    return "stable"


def _advisories(status: str) -> list[str]:
    if status == "critical":
        return [
            "Требуется срочное выездное обследование и согласование отключений.",
            "Отправьте аварийную бригаду и предупредите диспетчерскую смену.",
        ]
    if status == "alert":
        return [
            "Сверьте последние замеры по ИТП и проверьте канал связи с ПТК.",
            "Подготовьте заявки на ограничение потребления по подъездам.",
        ]
    if status == "watch":
        return [
            "Продолжайте наблюдение раз в шесть часов и фиксируйте тренд.",
        ]
    return ["Нагрузка в норме — поддерживайте штатный контроль."]


def generate_synthetic_summary(cell_id: str, year: int) -> dict:
    rng = SyntheticRandom(_seed(cell_id, year))
    leak_probability = max(7.0, min(82.0, 12.0 + rng.uniform(0, 55)))
    flow_rate = round(40 + rng.uniform(0, 160), 1)
    pressure = round(4.1 + rng.uniform(0, 1.6), 2)
    maintenance_score = round(65 + rng.uniform(0, 30), 2)
    supply_ratio = round(0.88 + rng.uniform(0, 0.22), 3)

    base_risk = 92 + rng.uniform(0, 42) + leak_probability * 0.35
    max_risk = base_risk + rng.uniform(0, 18)
    balance_index = max(32.0, min(100.0, 100 - (base_risk - 90) * 0.35))
    peak_balance = max(28.0, min(100.0, 100 - (max_risk - 90) * 0.4))

    status = _status_from_risk(base_risk)
    district_meta = DISTRICT_LOOKUP.get(cell_id, {})

    summary = {
        "cellId": cell_id,
        "riskIndex": round(base_risk, 2),
        "maxRisk": round(max_risk, 2),
        "balanceIndex": round(balance_index, 2),
        "peakBalance": round(peak_balance, 2),
        "maintenanceScore": round(maintenance_score, 2),
        "leakProbability": round(leak_probability, 1),
        "flowRate": flow_rate,
        "pressure": pressure,
        "supplyRatio": supply_ratio,
        "dataset": "synthetic",
        "status": status,
        "advisories": _advisories(status),
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "districtKey": district_meta.get("key"),
        "districtLabel": district_meta.get("label"),
    }
    return summary


def _seasonal_slice(data: list[dict], start_suffix: str, end_suffix: str) -> list[dict]:
    if not data:
        return []
    year = data[0]["date"].year
    start = datetime.strptime(f"{year}-{start_suffix}", "%Y-%m-%d").date()
    end = datetime.strptime(f"{year}-{end_suffix}", "%Y-%m-%d").date()
    rows = [row for row in data if start <= row["date"].date() <= end]
    if not rows:
        return []
    return [
        {
            "year": year,
            "avg_air_temp": round(mean(r["temperature_2m"] for r in rows), 2),
            "max_air_temp": round(max(r["temperature_2m"] for r in rows), 2),
            "min_air_temp": round(min(r["temperature_2m"] for r in rows), 2),
            "avg_humidity": round(mean(r["relative_humidity_2m"] for r in rows), 2),
            "total_precipitation": round(sum(r["rain"] for r in rows), 2),
            "avg_cloud_cover": round(mean(r["cloud_cover_high"] for r in rows), 2),
            "avg_soil_temp": round(mean(r["soil_temperature_100_to_255cm"] for r in rows), 2),
            "avg_soil_moisture": round(mean(r["soil_moisture_100_to_255cm"] for r in rows), 2),
        }
    ]


def generate_synthetic_weather(cell_id: str, year: int) -> dict:
    rng = SyntheticRandom(_seed(cell_id, year) ^ 0xABCDEF)
    start = datetime(year, 5, 1)
    days = 84
    entries: list[dict] = []
    for day in range(days):
        date = start + timedelta(days=day)
        seasonal_wave = math.sin((day / days) * math.pi)
        secondary_wave = math.sin((day % 30) / 30 * math.pi * 2)

        temperature = 12 + seasonal_wave * 14 + secondary_wave * 4 + rng.uniform(-2, 2)
        humidity = 70 - seasonal_wave * 20 + rng.uniform(-10, 10)
        cloud = 40 + seasonal_wave * 30 + rng.uniform(-20, 20)
        soil_temp = 6 + seasonal_wave * 9 + rng.uniform(-1.5, 1.5)
        soil_moisture = 55 + seasonal_wave * 15 + rng.uniform(-15, 15)
        rain_chance = rng.normalised()
        rain = 0.0
        if rain_chance > 0.82:
            rain = rng.uniform(0.5, 8.0)
        elif rain_chance > 0.7:
            rain = rng.uniform(0.1, 3.2)

        entries.append(
            {
                "date": date,
                "temperature_2m": temperature,
                "relative_humidity_2m": max(20.0, min(99.0, humidity)),
                "rain": round(rain, 2),
                "cloud_cover_high": max(5.0, min(100.0, cloud)),
                "soil_moisture_100_to_255cm": max(20.0, min(95.0, soil_moisture)),
                "soil_temperature_100_to_255cm": soil_temp,
            }
        )

    result = {
        "time": [row["date"].isoformat() for row in entries],
        "temperature_2m": [round(row["temperature_2m"], 2) for row in entries],
        "relative_humidity_2m": [round(row["relative_humidity_2m"], 2) for row in entries],
        "rain": [row["rain"] for row in entries],
        "cloud_cover_high": [round(row["cloud_cover_high"], 2) for row in entries],
        "soil_moisture_100_to_255cm": [round(row["soil_moisture_100_to_255cm"], 2) for row in entries],
        "soil_temperature_100_to_255cm": [round(row["soil_temperature_100_to_255cm"], 2) for row in entries],
    }

    seasonal = {}
    for name, (start_suffix, end_suffix) in SEASON_WINDOWS.items():
        seasonal_slice = _seasonal_slice(entries, start_suffix, end_suffix)
        if seasonal_slice:
            seasonal[name] = seasonal_slice
    result["seasonal"] = seasonal

    temps = [row["temperature_2m"] for row in entries]
    clouds = [row["cloud_cover_high"] for row in entries]
    rains = [row["rain"] for row in entries]
    result["avgTemperature"] = round(mean(temps), 2)
    result["avgCloudiness"] = round(mean(clouds), 2)
    result["totalRain"] = round(sum(rains), 2)

    return result


def generate_synthetic_yield(cell_id: str, year: int) -> list[dict]:
    rng = SyntheticRandom(_seed(cell_id, year) ^ 0x13579B)
    items = []
    for index in range(12):
        node_number = 100 + int(rng.uniform(0, 800))
        sample = f"PS{node_number:06d}"
        score = round(90 + rng.uniform(0, 45), 2)
        items.append({"sample": sample, "yield": score})
    items.sort(key=lambda item: item["yield"], reverse=True)
    return items


def generate_synthetic_bundle(cell_id: str, year: int) -> dict:
    summary = generate_synthetic_summary(cell_id, year)
    weather = generate_synthetic_weather(cell_id, year)
    yield_prediction = generate_synthetic_yield(cell_id, year)
    return {"summary": summary, "weather": weather, "yieldPrediction": yield_prediction}
