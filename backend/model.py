"""Water consumption analytics helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import csv
import hashlib
import io
from functools import lru_cache
from pathlib import Path
import os
from typing import Iterable

import numpy as np
import pandas as pd

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"

# Allow overriding feedback storage path via env (e.g., Cloud Run writable /tmp)
_FEEDBACK_PATH = Path(os.environ.get("FEEDBACK_PATH") or (DATA_DIR / "feedback.csv"))

_FEEDBACK_REGISTRY: dict[str, dict] = {}
_ANOMALY_CONTEXT: dict[str, dict] | None = None


FACTOR_DEFINITIONS: dict[str, dict[str, str]] = {
    "deviation_trend": {
        "label": "Deviation trend",
        "description": "Change in the ITP vs ODDP gap over the latest periods",
    },
    "supply_ratio": {
        "label": "Supply balance",
        "description": "Ratio between cold-water feed and hot-water output",
    },
    "dispatcher_feedback": {
        "label": "Dispatcher feedback",
        "description": "Recent operator actions on similar incidents",
    },
    "weather_context": {
        "label": "Weather factors",
        "description": "Temperature and precipitation drivers affecting consumption",
    },
}


def _factor_payload(factor_id: str, impact: float) -> dict:
    meta = FACTOR_DEFINITIONS.get(factor_id)
    if not meta:
        raise KeyError(f"Unknown factor id '{factor_id}'")
    return {
        "id": factor_id,
        "label": meta["label"],
        "impact": round(float(impact), 1),
    }


def _anomaly_hash(mkd_id: str, dt: datetime, odpu_id: str) -> str:
    return hashlib.sha1(f"{mkd_id}-{dt:%Y%m%d}-{odpu_id}".encode("utf-8")).hexdigest()[:12]


def _build_anomaly_context() -> dict[str, dict]:
    global _ANOMALY_CONTEXT
    if _ANOMALY_CONTEXT is not None:
        return _ANOMALY_CONTEXT

    telemetry = _telemetry()
    contexts: dict[str, dict] = {}
    for _, row in telemetry.iterrows():
        dt = row["date"]
        if not isinstance(dt, datetime):
            dt = pd.to_datetime(dt)
        anomaly_id = _anomaly_hash(str(row["mkd_id"]), dt, str(row["odpu_id"]))
        contexts[anomaly_id] = {
            "mkd_id": str(row["mkd_id"]),
            "mkd_address": str(row.get("mkd_address", "")),
            "odpu_id": str(row["odpu_id"]),
            "itp_id": str(row.get("itp_id", "")),
            "district": str(row.get("district", "")),
            "date": dt.strftime("%Y-%m-%d"),
        }

    _ANOMALY_CONTEXT = contexts
    return contexts


def _load_feedback_registry() -> None:
    if not _FEEDBACK_PATH.exists():
        return

    try:
        frame = pd.read_csv(_FEEDBACK_PATH)
    except Exception:
        return

    if frame.empty:
        return

    for _, row in frame.iterrows():
        try:
            updated_at_raw = str(row.get("updated_at"))
            updated_at = (
                datetime.fromisoformat(updated_at_raw.replace("Z", ""))
                if updated_at_raw and updated_at_raw != "nan"
                else datetime.utcnow()
            )
        except ValueError:
            updated_at = datetime.utcnow()

        comment = row.get("comment")
        if pd.isna(comment) or comment == "":
            comment = None

        _FEEDBACK_REGISTRY[str(row["anomaly_id"])] = {
            "status": str(row.get("status", "unreviewed")),
            "comment": comment,
            "updatedAt": updated_at,
            "mkd_id": str(row.get("mkd_id", "")),
            "mkd_address": str(row.get("mkd_address", "")),
            "odpu_id": str(row.get("odpu_id", "")),
            "itp_id": str(row.get("itp_id", "")),
            "district": str(row.get("district", "")),
            "date": str(row.get("date", "")),
        }


def _persist_feedback_registry() -> None:
    if not _FEEDBACK_REGISTRY:
        _FEEDBACK_PATH.unlink(missing_ok=True)
        return

    records = []
    for anomaly_id, entry in _FEEDBACK_REGISTRY.items():
        updated_at = entry.get("updatedAt")
        if isinstance(updated_at, datetime):
            updated_str = updated_at.isoformat(timespec="seconds") + "Z"
        else:
            updated_str = str(updated_at)

        records.append(
            {
                "anomaly_id": anomaly_id,
                "date": entry.get("date", ""),
                "mkd_id": entry.get("mkd_id", ""),
                "mkd_address": entry.get("mkd_address", ""),
                "itp_id": entry.get("itp_id", ""),
                "odpu_id": entry.get("odpu_id", ""),
                "district": entry.get("district", ""),
                "status": entry.get("status", "unreviewed"),
                "comment": entry.get("comment") or "",
                "updated_at": updated_str,
            }
        )

    frame = pd.DataFrame.from_records(records)
    frame.sort_values("updated_at", inplace=True)
    _FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(_FEEDBACK_PATH, index=False)


_load_feedback_registry()


@dataclass(frozen=True)
class BuildingSummary:
    mkd_id: str
    mkd_address: str
    mkd_lat: float
    mkd_lon: float
    itp_id: str
    itp_name: str
    itp_lat: float
    itp_lon: float
    odpu_id: str
    district: str
    risk_index: float
    max_deviation: float
    anomaly_rate: float
    anomaly_count: int
    supply_ratio: float
    updated_at: datetime

    def as_payload(self) -> dict:
        return {
            "mkdId": self.mkd_id,
            "mkdAddress": self.mkd_address,
            "mkdLat": round(self.mkd_lat, 6),
            "mkdLon": round(self.mkd_lon, 6),
            "itpId": self.itp_id,
            "itpName": self.itp_name,
            "itpLat": round(self.itp_lat, 6),
            "itpLon": round(self.itp_lon, 6),
            "odpuId": self.odpu_id,
            "district": self.district,
            "riskIndex": round(self.risk_index, 2),
            "maxDeviation": round(self.max_deviation * 100, 2),
            "anomalyRate": round(self.anomaly_rate * 100, 1),
            "anomalyCount": self.anomaly_count,
            "supplyRatio": round(self.supply_ratio, 3),
            "updatedAt": self.updated_at.isoformat(timespec="seconds") + "Z",
        }


def _load_table(path: Path) -> pd.DataFrame:
    parquet_path = path.with_suffix(".parquet")
    csv_path = path.with_suffix(".csv")

    if parquet_path.exists():
        try:
            df = pd.read_parquet(parquet_path)
        except Exception:
            if not csv_path.exists():
                raise
            df = pd.read_csv(csv_path)
    elif csv_path.exists():
        df = pd.read_csv(path.with_suffix(".csv"))
    else:
        raise FileNotFoundError(f"Telemetry dataset missing at {path}(.csv|.parquet)")

    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
    return df


@lru_cache(maxsize=1)
def _telemetry() -> pd.DataFrame:
    telemetry = _load_table(DATA_DIR / "telemetry")
    required = {
        "mkd_id",
        "mkd_address",
        "itp_id",
        "itp_name",
        "odpu_id",
        "district",
        "date",
        "itp_cold_water",
        "odpu_hot_water",
        "deviation_ratio",
    }
    missing = required - set(telemetry.columns)
    if missing:
        raise ValueError(f"Telemetry dataset missing columns: {', '.join(sorted(missing))}")

    anomaly_col = telemetry.get("anomaly")
    if anomaly_col is not None:
        coerced = (
            anomaly_col.astype(str)
            .str.strip()
            .str.lower()
            .isin({"true", "1", "yes", "y"})
        )
        telemetry["anomaly"] = np.where(
            coerced,
            True,
            telemetry["deviation_ratio"].astype(float) > 0.10,
        )
    else:
        telemetry["anomaly"] = telemetry["deviation_ratio"].astype(float) > 0.10
    return telemetry


def _seed(value: str) -> int:
    return int(hashlib.sha1(value.encode("utf-8")).hexdigest(), 16) % (2**31)


def _build_summary(frame: pd.DataFrame) -> BuildingSummary:
    mkd_id = frame["mkd_id"].iat[0]
    mkd_address = frame["mkd_address"].iat[0]
    mkd_lat = float(frame.get("mkd_lat", pd.Series([55.75])).iat[0])
    mkd_lon = float(frame.get("mkd_lon", pd.Series([37.61])).iat[0])
    itp_id = frame["itp_id"].iat[0]
    itp_name = frame.get("itp_name", pd.Series(["ITP"])).iat[0]
    itp_lat = float(frame.get("itp_lat", pd.Series([mkd_lat])).iat[0])
    itp_lon = float(frame.get("itp_lon", pd.Series([mkd_lon])).iat[0])
    odpu_id = frame["odpu_id"].iat[0]
    district = frame.get("district", pd.Series(["Moscow"]).astype(str)).iat[0]

    deviation = frame["deviation_ratio"].astype(float)
    anomaly_rate = float(np.mean(frame["anomaly"].astype(bool))) if len(frame) else 0.0
    anomaly_count = int(frame["anomaly"].astype(bool).sum())
    max_deviation = float(deviation.max() if len(deviation) else 0.0)

    cold_total = float(frame["itp_cold_water"].sum())
    hot_total = float(frame["odpu_hot_water"].sum())
    supply_ratio = hot_total / cold_total if cold_total else 0.0

    risk_index = (anomaly_rate * 65 + max_deviation * 120 + (1 - supply_ratio) * 40) + 45
    risk_index = float(np.clip(risk_index, 60, 180))

    return BuildingSummary(
        mkd_id=mkd_id,
        mkd_address=mkd_address,
        mkd_lat=mkd_lat,
        mkd_lon=mkd_lon,
        itp_id=itp_id,
        itp_name=itp_name,
        itp_lat=itp_lat,
        itp_lon=itp_lon,
        odpu_id=odpu_id,
        district=district,
        risk_index=risk_index,
        max_deviation=max_deviation,
        anomaly_rate=anomaly_rate,
        anomaly_count=anomaly_count,
        supply_ratio=supply_ratio,
        updated_at=datetime.utcnow(),
    )


def list_building_summaries(year: int) -> list[dict]:
    telemetry = _telemetry()
    frame = telemetry[telemetry["date"].dt.year == year]
    summaries = []
    for mkd_id, group in frame.groupby("mkd_id"):
        summary = _build_summary(group)
        summaries.append(summary.as_payload())
    summaries.sort(key=lambda item: item["riskIndex"], reverse=True)
    return summaries


def _forecast_actions(frame: pd.DataFrame, seed: int) -> list[dict]:
    rng = np.random.default_rng(seed)
    base_levels = [
        ("communication", "Verify RTU connectivity", 0.62),
        ("hydraulics", "Capture pressure checkpoints", 0.54),
        ("inspection", "Schedule riser inspection", 0.71),
        ("metering", "Reconcile ODDP and apartment meters", 0.48),
    ]
    deviation = frame["deviation_ratio"].astype(float)
    recent = float(deviation.tail(3).mean() if len(deviation) else 0.0)
    supply_ratio = frame["odpu_hot_water"].sum() / max(frame["itp_cold_water"].sum(), 1)

    def build_factor_rows() -> list[dict]:
        factors = [
            _factor_payload("deviation_trend", recent * 100),
            _factor_payload("supply_ratio", supply_ratio * 100),
        ]
        # Add additional flavour factors so toggles have visible impact.
        dispatcher_weight = rng.uniform(5, 35)
        weather_weight = rng.uniform(0, 25)
        factors.append(_factor_payload("dispatcher_feedback", dispatcher_weight))
        factors.append(_factor_payload("weather_context", weather_weight))
        return factors

    outputs = []
    for code, description, base in base_levels:
        weight = np.clip(base + recent * rng.uniform(0.8, 1.6), 0.15, 0.95)
        outputs.append(
            {
                "code": code,
                "description": description,
                "confidence": round(weight, 2),
                "factors": build_factor_rows(),
            }
        )
    outputs.sort(key=lambda item: item["confidence"], reverse=True)
    return outputs


def _build_anomalies(frame: pd.DataFrame) -> list[dict]:
    anomalies = []
    for idx, row in frame.iterrows():
        if not bool(row.get("anomaly")):
            continue
        anomaly_id = _anomaly_hash(row["mkd_id"], row["date"], row["odpu_id"])
        feedback = _FEEDBACK_REGISTRY.get(anomaly_id)
        updated_at = feedback.get("updatedAt") if feedback else None
        if isinstance(updated_at, datetime):
            updated_str = updated_at.isoformat(timespec="seconds") + "Z"
        else:
            updated_str = None
        anomalies.append(
            {
                "id": anomaly_id,
                "date": row["date"].isoformat(),
                "deviationPercent": round(float(row["deviation_ratio"]) * 100, 2),
                "itpCold": round(float(row["itp_cold_water"]), 2),
                "odpuHot": round(float(row["odpu_hot_water"]), 2),
                "status": feedback.get("status") if feedback else "unreviewed",
                "comment": feedback.get("comment") if feedback else None,
                "updatedAt": updated_str,
            }
        )
    return anomalies


def _build_time_series(frame: pd.DataFrame) -> dict:
    labels = [int(row.timestamp() * 1000) for row in frame["date"]]
    return {
        "labels": labels,
        "itpCold": [round(v, 2) for v in frame["itp_cold_water"].tolist()],
        "odpuHot": [round(v, 2) for v in frame["odpu_hot_water"].tolist()],
        "deviationPercent": [round(v * 100, 2) for v in frame["deviation_ratio"].tolist()],
    }


def _factor_catalog() -> list[dict]:
    catalog = []
    for factor_id, meta in FACTOR_DEFINITIONS.items():
        catalog.append(
            {
                "id": factor_id,
                "label": meta["label"],
                "description": meta["description"],
            }
        )
    return catalog


def build_building_bundle(mkd_id: str, year: int) -> dict:
    telemetry = _telemetry()
    frame = telemetry[(telemetry["mkd_id"] == mkd_id) & (telemetry["date"].dt.year == year)]
    if frame.empty:
        raise KeyError(f"MKD {mkd_id} not found for year {year}")

    summary = _build_summary(frame)
    seed = _seed(f"{mkd_id}-{year}")
    recommendations = _forecast_actions(frame, seed)
    anomalies = _build_anomalies(frame)
    time_series = _build_time_series(frame.sort_values("date"))

    analytics = {
        "mkdId": summary.mkd_id,
        "mkdAddress": summary.mkd_address,
        "itpId": summary.itp_id,
        "odpuId": summary.odpu_id,
        "mkdLat": summary.mkd_lat,
        "mkdLon": summary.mkd_lon,
        "anomalies": anomalies,
        "factorCatalog": _factor_catalog(),
        "anomalyShare": round(summary.anomaly_rate * 100, 1),
        "medianDeviation": round(float(frame["deviation_ratio"].median() * 100), 1),
        "averageDeviation": round(float(frame["deviation_ratio"].mean() * 100), 1),
    }

    return {
        "summary": summary.as_payload(),
        "telemetry": time_series,
        "recommendations": recommendations,
        "analytics": analytics,
    }


def register_feedback(anomaly_id: str, status: str, comment: str | None = None) -> dict:
    if status not in {"confirmed", "dismissed", "unreviewed"}:
        raise ValueError("Unsupported status value")

    context = _build_anomaly_context().get(anomaly_id)
    if not context:
        raise ValueError("Unable to match anomaly with telemetry")

    comment = comment.strip() if comment else None
    timestamp = datetime.utcnow()
    entry = {
        "status": status,
        "comment": comment,
        "updatedAt": timestamp,
        **context,
    }
    _FEEDBACK_REGISTRY[anomaly_id] = entry
    _persist_feedback_registry()
    return {
        "id": anomaly_id,
        "status": status,
        "comment": comment,
        "updatedAt": timestamp.isoformat(timespec="seconds") + "Z",
    }


def export_report(mkd_id: str, year: int) -> bytes:
    bundle = build_building_bundle(mkd_id, year)
    telemetry = bundle["telemetry"]
    buffer = io.StringIO()
    buffer.write("date,itp_cold,odpu_hot,deviation_percent\n")
    for ts, cold, hot, deviation in zip(
        telemetry["labels"], telemetry["itpCold"], telemetry["odpuHot"], telemetry["deviationPercent"]
    ):
        dt = datetime.utcfromtimestamp(ts / 1000).strftime("%Y-%m-%d")
        buffer.write(f"{dt},{cold},{hot},{deviation}\n")
    return buffer.getvalue().encode("utf-8")


def export_anomaly_database(*, year: int | None = None, mkd_id: str | None = None) -> bytes:
    telemetry = _telemetry()

    frame = telemetry.copy()
    if year is not None:
        frame = frame[frame["date"].dt.year == year]
    if mkd_id is not None:
        frame = frame[frame["mkd_id"].astype(str) == str(mkd_id)]

    frame = frame[frame["anomaly"].astype(bool)]

    buffer = io.StringIO()
    fieldnames = [
        "anomaly_id",
        "date",
        "mkd_id",
        "mkd_address",
        "itp_id",
        "odpu_id",
        "district",
        "deviation_percent",
        "itp_cold",
        "odpu_hot",
        "status",
        "comment",
        "updated_at",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames)
    writer.writeheader()

    if frame.empty:
        return buffer.getvalue().encode("utf-8")

    contexts = _build_anomaly_context()

    for _, row in frame.sort_values("date").iterrows():
        dt_value = row["date"]
        if not isinstance(dt_value, datetime):
            dt_value = pd.to_datetime(dt_value)
        anomaly_id = _anomaly_hash(str(row["mkd_id"]), dt_value, str(row["odpu_id"]))
        context = contexts.get(anomaly_id, {})
        feedback = _FEEDBACK_REGISTRY.get(anomaly_id, {})

        updated_at = feedback.get("updatedAt")
        if isinstance(updated_at, datetime):
            updated_str = updated_at.isoformat(timespec="seconds") + "Z"
        elif updated_at:
            updated_str = str(updated_at)
        else:
            updated_str = ""

        comment = feedback.get("comment") or ""
        comment = str(comment).replace("\n", " ").strip()

        writer.writerow(
            {
                "anomaly_id": anomaly_id,
                "date": dt_value.strftime("%Y-%m-%d"),
                "mkd_id": str(row.get("mkd_id", "")),
                "mkd_address": str(context.get("mkd_address") or row.get("mkd_address", "")),
                "itp_id": str(row.get("itp_id", "")),
                "odpu_id": str(row.get("odpu_id", "")),
                "district": str(row.get("district", "")),
                "deviation_percent": f"{float(row.get('deviation_ratio', 0.0)) * 100:.2f}",
                "itp_cold": f"{float(row.get('itp_cold_water', 0.0)):.2f}",
                "odpu_hot": f"{float(row.get('odpu_hot_water', 0.0)):.2f}",
                "status": str(feedback.get("status", "unreviewed")),
                "comment": comment,
                "updated_at": updated_str,
            }
        )

    return buffer.getvalue().encode("utf-8")


def iterate_years() -> Iterable[int]:
    telemetry = _telemetry()
    return [int(year) for year in sorted(telemetry["date"].dt.year.unique())]
