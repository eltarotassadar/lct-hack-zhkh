from datetime import datetime, date
from typing import Annotated

import aiohttp
import h3
import uvicorn
from fastapi import FastAPI, Query, Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from model import predict
from prepare_weather import prepare_weather, aggregate_weather

app = FastAPI(docs_url='/api/docs', redoc_url='/api/redoc')

app.add_middleware(CORSMiddleware,
                   allow_origins=['*'],
                   allow_credentials=True,
                   allow_methods=["*"],
                   allow_headers=["*"])

class GetPolygonsRequest(BaseModel):
    ids: list[str]
    now: int

class GetPolygonRequest(BaseModel):
    now: int

url = "https://archive-api.open-meteo.com/v1/archive"

@app.get("/api/health")
async def healthcheck():
    return {"status": "OK"}

@app.post("/api/polygons")
async def get_polygons(request: GetPolygonsRequest):
    response = []
    for cell in request.ids:
        hexagon = {
            'cellId': cell,
            'center': h3.cell_to_latlng(cell),
            'boundary': h3.cell_to_boundary(cell),
        }

        response.append(hexagon)

    return response

@app.get('/api/polygons/{cell_id}')
async def get_polygon(cell_id: Annotated[str, Path()], request: Annotated[GetPolygonRequest, Query()]):
    hexagon = {
        'cellId': cell_id,
        'center': h3.cell_to_latlng(cell_id),
        'boundary': h3.cell_to_boundary(cell_id),
    }

    now = round(int(request.now) / 1000)

    year = datetime.fromtimestamp(now).year
    start_date = date(year, 5, 1)
    end_date = date(year, 10, 1)

    params = {
        "latitude": hexagon['center'][0],
        "longitude": hexagon['center'][1],
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": ["temperature_2m", "relative_humidity_2m", "rain", "cloud_cover_high", "soil_moisture_100_to_255cm", "soil_temperature_100_to_255cm"],
        "timezone": "Europe/Moscow",
        "models": "best_match"
    }

    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
        resp = await session.get(url, params=params)
        data = await resp.json()

        hexagon['weather'] = await aggregate_weather(data)

        weather = await prepare_weather(data)

        hexagon['yieldPrediction'] = await predict(year, weather)

    return hexagon

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8010)