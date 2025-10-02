import * as h3 from 'h3-js';
import { monitoringProfiles } from '../domain/monitoringProfiles';

const allMonitoringNodes = Object.keys(monitoringProfiles).sort();

function stringToSeed(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return hash >>> 0;
}

function mulberry32(a) {
  return function generator() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function abbreviateHexagonId(cellId) {
  if (!cellId) return '—';
  return cellId.slice(-5).toUpperCase();
}

export function getAllMonitoringNodeIds() {
  return allMonitoringNodes;
}

export function createSyntheticHexagonSummary(cellId, year) {
  const baseSeed = stringToSeed(`${cellId}-${year}`);
  const rand = mulberry32(baseSeed);

  const center = h3.cellToLatLng(cellId);
  const boundary = h3.cellToBoundary(cellId);

  const flowRate = 45 + rand() * 160; // m3/h
  const pressure = 4.8 + rand() * 1.9; // bar
  const leakProbability = clamp(0.12 + rand() * 0.55, 0.05, 0.8);
  const maintenanceScore = 0.85 + rand() * 0.25;

  const baseRisk = 92 + rand() * 48 + leakProbability * 55;
  const peakDeviation = baseRisk + rand() * 18;

  const advisories = [];
  if (baseRisk > 135) {
    advisories.push('Нужна экстренная проверка ИТП и УУ — согласовать команду реагирования.');
    advisories.push('Сформировать акт по подозрению на несанкционированный отбор ресурса.');
  } else if (baseRisk > 115) {
    advisories.push('Запросить уточненные показания с резервных датчиков и проверить связь УСПД.');
    advisories.push('Подготовить бригаду для выборочного обхода стояков в течение суток.');
  } else if (baseRisk > 100) {
    advisories.push('Зафиксировать тенденцию в журнале смены и продолжить мониторинг каждые 6 часов.');
  } else {
    advisories.push('Сценарий в норме, оставить автоматическое наблюдение.');
  }

  const status = baseRisk > 135 ? 'critical' : baseRisk >= 115 ? 'alert' : baseRisk >= 100 ? 'watch' : 'stable';

  return {
    cellId,
    center,
    boundary,
    riskIndex: Number(baseRisk.toFixed(2)),
    maxRisk: Number(peakDeviation.toFixed(2)),
    yield: Number(flowRate.toFixed(2)),
    maxYield: Number((flowRate * (1 + leakProbability * 0.4)).toFixed(2)),
    score: Number((maintenanceScore * 100).toFixed(2)),
    leakProbability: Number((leakProbability * 100).toFixed(1)),
    flowRate: Number(flowRate.toFixed(1)),
    pressure: Number(pressure.toFixed(2)),
    dataset: 'synthetic',
    status,
    advisories,
    updatedAt: new Date().toISOString(),
  };
}

function createTelemetrySeries(cellId, year, startTimestamp) {
  const hours = 24 * 7;
  const start = new Date(startTimestamp);
  const telemetrySeed = stringToSeed(`${cellId}-${year}-${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`);
  const rand = mulberry32(telemetrySeed);

  const labels = [];
  const temperature = [];
  const rain = [];
  const humidity = [];
  const cloudiness = [];
  const soilMoisture = [];
  const soilTemperature = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const ts = startTimestamp + hour * 60 * 60 * 1000;
    const date = new Date(ts);
    labels.push(ts);

    const dailyCycle = Math.sin(((hour % 24) / 24) * Math.PI * 2);
    const seasonalCycle = Math.sin(((date.getMonth() + 1) / 12) * Math.PI * 2);

    const temp = clamp(4 + seasonalCycle * 14 + dailyCycle * 6 + (rand() - 0.5) * 2.2, -15, 32);
    const hum = clamp(68 - seasonalCycle * 20 + dailyCycle * 8 + (rand() - 0.5) * 18, 28, 99);
    const cloud = clamp(45 + seasonalCycle * 25 + (rand() - 0.5) * 40, 5, 100);
    const soilT = clamp(6 + seasonalCycle * 9 + (rand() - 0.5) * 1.8, -4, 24);
    const soilM = clamp(48 + seasonalCycle * 12 + (rand() - 0.5) * 20, 15, 95);

    const rainChance = rand();
    const rainValue = rainChance > 0.88 ? clamp(rand() * 6.5, 0.2, 9.5) : rainChance > 0.75 ? clamp(rand() * 3.2, 0.1, 4) : 0;

    temperature.push(Number(temp.toFixed(2)));
    humidity.push(Number(hum.toFixed(2)));
    cloudiness.push(Number(cloud.toFixed(2)));
    soilTemperature.push(Number(soilT.toFixed(2)));
    soilMoisture.push(Number(soilM.toFixed(2)));
    rain.push(Number(rainValue.toFixed(2)));
  }

  return {
    labels,
    temperature,
    rain,
    humidity,
    cloudiness,
    soilMoisture,
    soilTemperature,
  };
}

function createSyntheticForecasts(cellId, year, nodeIds = allMonitoringNodes) {
  const seed = stringToSeed(`forecast-${cellId}-${year}`);
  const rand = mulberry32(seed);
  const count = Math.min(14, nodeIds.length);
  const offset = Math.floor(rand() * nodeIds.length);

  const items = [];
  for (let index = 0; index < count; index += 1) {
    const nodeId = nodeIds[(offset + index) % nodeIds.length];
    const baseline = 92 + rand() * 45;
    const fluctuation = (rand() - 0.5) * 18;
    const riskScore = Number((baseline + fluctuation).toFixed(2));
    items.push({ nodeId, riskScore });
  }

  items.sort((a, b) => b.riskScore - a.riskScore);
  return items;
}

export function createSyntheticBundle({ cellId, year, startTimestamp, nodeIds = allMonitoringNodes }) {
  const summary = createSyntheticHexagonSummary(cellId, year);
  const telemetry = createTelemetrySeries(cellId, year, startTimestamp);
  const forecasts = createSyntheticForecasts(cellId, year, nodeIds);

  const averageRisk = forecasts.reduce((acc, item) => acc + item.riskScore, 0) / (forecasts.length || 1);
  summary.riskIndex = Number(averageRisk.toFixed(2));
  summary.maxRisk = Number((forecasts[0]?.riskScore ?? summary.maxRisk).toFixed(2));

  return { summary, telemetry, forecasts };
}
