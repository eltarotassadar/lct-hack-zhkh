import * as h3 from 'h3-js';
import { monitoringProfiles } from '../domain/monitoringProfiles';
import { districtLookup } from '../domain/territories';

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
  const districtMeta = districtLookup[cellId];

  const flowRate = 45 + rand() * 160; // m3/h
  const pressure = 4.2 + rand() * 1.5; // bar
  const leakProbability = clamp(0.12 + rand() * 0.55, 0.05, 0.8);
  const maintenanceScore = 0.74 + rand() * 0.25;

  const baseRisk = 92 + rand() * 48 + leakProbability * 55;
  const peakDeviation = baseRisk + rand() * 18;
  const balanceIndex = clamp(100 - (baseRisk - 90) * 0.4, 35, 100);
  const peakBalance = clamp(100 - (peakDeviation - 90) * 0.45, 30, 100);
  const supplyRatio = clamp(0.9 + rand() * 0.18, 0.82, 1.18);

  const advisories = [];
  if (baseRisk > 135) {
    advisories.push('Требуется срочная проверка ИТП и узла учёта — направьте аварийную бригаду.');
    advisories.push('Подготовьте акт о предполагаемом несанкционированном потреблении.');
  } else if (baseRisk > 115) {
    advisories.push('Запросите показания с резервных датчиков и проверьте связь с ПТК.');
    advisories.push('Подготовьте бригаду для выборочного обхода стояков в течение 24 часов.');
  } else if (baseRisk > 100) {
    advisories.push(
      'Зафиксируйте тренд в журнале смены и продолжайте контроль каждые шесть часов.',
    );
  } else {
    advisories.push('Сценарий в норме — поддерживайте автоматический мониторинг.');
  }

  const status =
    baseRisk > 135 ? 'critical' : baseRisk >= 115 ? 'alert' : baseRisk >= 100 ? 'watch' : 'stable';

  return {
    cellId,
    center,
    boundary,
    riskIndex: Number(baseRisk.toFixed(2)),
    maxRisk: Number(peakDeviation.toFixed(2)),
    balanceIndex: Number(balanceIndex.toFixed(2)),
    peakBalance: Number(peakBalance.toFixed(2)),
    maintenanceScore: Number((maintenanceScore * 100).toFixed(2)),
    leakProbability: Number((leakProbability * 100).toFixed(1)),
    flowRate: Number(flowRate.toFixed(1)),
    pressure: Number(pressure.toFixed(2)),
    supplyRatio: Number(supplyRatio.toFixed(3)),
    dataset: 'synthetic',
    status,
    advisories,
    updatedAt: new Date().toISOString(),
    districtKey: districtMeta?.key ?? null,
    districtLabel: districtMeta?.label ?? null,
  };
}

function createTelemetrySeries(cellId, year, startTimestamp) {
  const hours = 24 * 7;
  const start = new Date(startTimestamp);
  const telemetrySeed = stringToSeed(
    `${cellId}-${year}-${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`,
  );
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
    const rainValue =
      rainChance > 0.88
        ? clamp(rand() * 6.5, 0.2, 9.5)
        : rainChance > 0.75
          ? clamp(rand() * 3.2, 0.1, 4)
          : 0;

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

export function createSyntheticBundle({
  cellId,
  year,
  startTimestamp,
  nodeIds = allMonitoringNodes,
}) {
  const summary = createSyntheticHexagonSummary(cellId, year);
  const telemetry = createTelemetrySeries(cellId, year, startTimestamp);
  const forecasts = createSyntheticForecasts(cellId, year, nodeIds);

  const averageRisk =
    forecasts.reduce((acc, item) => acc + item.riskScore, 0) / (forecasts.length || 1);
  summary.riskIndex = Number(averageRisk.toFixed(2));
  summary.maxRisk = Number((forecasts[0]?.riskScore ?? summary.maxRisk).toFixed(2));

  const analytics = {
    mkdId: `SYN-${cellId.slice(-6).toUpperCase()}`,
    mkdAddress: 'Синтетический адрес, Москва',
    daysObserved: 90,
    anomalyCount: Math.round((summary.leakProbability / 100) * 12),
    anomalyRate: Number(summary.leakProbability.toFixed(2)),
    averageDeviation: Number((100 - summary.balanceIndex).toFixed(2)),
    maxDeviation: Number((100 - summary.peakBalance).toFixed(2)),
    medianDeviation: Number(((100 - summary.balanceIndex) * 0.6).toFixed(2)),
    supplyRatio: summary.supplyRatio,
    recentMeasurements: [],
    deviationSeries: [],
  };

  return { summary, telemetry, forecasts, analytics };
}
