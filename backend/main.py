from __future__ import annotations

from datetime import date, datetime

import aiohttp
import uvicorn
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# Support running both as a package (backend.main) and as a script from backend/
try:  # package import (Docker/Cloud Run)
    from .model import (
        build_building_bundle,
        export_anomaly_database,
        export_report,
        iterate_years,
        list_building_summaries,
        register_feedback,
    )
    from .prepare_weather import aggregate_weather
except Exception:  # script import (local dev from backend/)
    from model import (  # type: ignore
        build_building_bundle,
        export_anomaly_database,
        export_report,
        iterate_years,
        list_building_summaries,
        register_feedback,
    )
    from prepare_weather import aggregate_weather  # type: ignore

# Geo helpers (dual import for package/script modes)
try:
    from .geo import enrich_polygon, resolve_polygons
except Exception:  # type: ignore
    from geo import enrich_polygon, resolve_polygons  # type: ignore

app = FastAPI(docs_url="/api/docs", redoc_url="/api/redoc")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FeedbackPayload(BaseModel):
    anomaly_id: str = Field(description="Anomaly identifier")
    status: str = Field(description="confirmed | dismissed | unreviewed")
    comment: str | None = Field(default=None, description="Dispatcher comment")


class PolygonListPayload(BaseModel):
    ids: list[str] = Field(default_factory=list, description="H3 cell ids")
    now: int | None = Field(default=None, description="Client timestamp, ms")
    year: int | None = Field(default=None, description="Reporting year override")


class PolygonListPayload(BaseModel):
    ids: list[str] = Field(default_factory=list, description="H3 cell ids")
    now: int | None = Field(default=None, description="Client timestamp, ms")


url = "https://archive-api.open-meteo.com/v1/archive"


@app.get("/api/health")
async def healthcheck():
    return {"status": "OK"}


@app.get("/api/years")
async def available_years():
    return {"years": iterate_years()}


@app.get("/api/buildings")
async def get_buildings(year: int = Query(..., ge=2000, le=2100)):
    return list_building_summaries(year)


@app.get("/api/buildings/{mkd_id}")
async def get_building(
    mkd_id: str = Path(description="Building identifier"),
    year: int = Query(..., ge=2000, le=2100),
    include_weather: bool = Query(True, description="Include weather series"),
    now: int | None = Query(None, description="Client timestamp, ms"),
):
    try:
        bundle = build_building_bundle(mkd_id, year)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not include_weather:
        return bundle

    timestamp = round((now or datetime.utcnow().timestamp() * 1000) / 1000)
    resolved_year = year or datetime.utcfromtimestamp(timestamp).year
    start_date = date(resolved_year, 1, 1)
    end_date = date(resolved_year, 12, 31)

    center_lat = bundle["summary"].get("mkdLat") or 55.75
    center_lon = bundle["summary"].get("mkdLon") or 37.61

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

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        try:
            resp = await session.get(url, params=params)
            resp.raise_for_status()
            data = await resp.json()
            bundle["weather"] = await aggregate_weather(data)
        except Exception:
            bundle["weather"] = {}

    return bundle


@app.post("/api/buildings/{mkd_id}/feedback")
async def submit_feedback(mkd_id: str, payload: FeedbackPayload):
    try:
        result = register_feedback(payload.anomaly_id, payload.status, payload.comment)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse(status_code=201, content=result)


@app.get("/api/buildings/{mkd_id}/report")
async def download_report(mkd_id: str, year: int = Query(..., ge=2000, le=2100)):
    try:
        content = export_report(mkd_id, year)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filename = f"report-{mkd_id}-{year}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=content, media_type="text/csv", headers=headers)


@app.get("/api/anomalies/export")
async def download_anomalies(
    year: int | None = Query(None, ge=2000, le=2100),
    mkd_id: str | None = Query(None, description="Filter by building id"),
):
    content = export_anomaly_database(year=year, mkd_id=mkd_id)

    parts = ["anomalies"]
    if mkd_id:
        parts.append(mkd_id)
    if year:
        parts.append(str(year))
    filename = "-".join(parts) + ".csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}
    return Response(content=content, media_type="text/csv", headers=headers)


@app.post("/api/polygons")
async def list_polygons(payload: PolygonListPayload):
    return await resolve_polygons(payload.ids, payload.year)


@app.get("/api/polygons/{cell_id}")
async def get_polygon(
    cell_id: str,
    now: int = Query(..., description="Client timestamp, ms"),
    year: int | None = Query(None, ge=2000, le=2100),
):
    epoch_seconds = max(1, int(now) // 1000)
    try:
        return await enrich_polygon(cell_id, epoch_seconds, year)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load polygon bundle") from exc


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010)
