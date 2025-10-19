import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DatePicker from 'react-datepicker';
import { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import axios from 'axios';

import * as h3 from 'h3-js';

import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';

import 'chartjs-adapter-date-fns';
import setDefaultOptions from 'date-fns/setDefaultOptions';
import addDays from 'date-fns/addDays';
import format from 'date-fns/format';
import setYear from 'date-fns/setYear';

import { ru } from 'date-fns/locale';
import { monitoringProfiles, reportingYears } from '../domain/monitoringProfiles';
import InfoTooltip from '../components/InfoTooltip.jsx';
import MethodologyModal from '../components/MethodologyModal.jsx';
import Api from '../utils/api.js';
import {
  districtLookup,
  presetCellsToMap,
  territoryOrder,
  territoryPresets,
} from '../domain/territories.js';
import {
  abbreviateHexagonId,
  createSyntheticBundle,
  createSyntheticHexagonSummary,
  getAllMonitoringNodeIds,
} from '../utils/syntheticData';
setDefaultOptions({ locale: ru });
registerLocale('ru', ru);
setDefaultLocale('ru');

ChartJS.register(...registerables);

const MOSCOW_BOUNDARY = [
  [
    [55.917, 37.375],
    [55.917, 37.879],
    [55.53, 37.879],
    [55.53, 37.375],
    [55.917, 37.375],
  ],
];

const MOSCOW_HEX_RESOLUTION = 6;

const DefaultAreasConfig = Object.keys(territoryPresets).reduce((acc, key) => {
  acc[key] = presetCellsToMap(key);
  return acc;
}, {});

const DefaultAreasLabels = Object.entries(territoryPresets).reduce((acc, [key, preset]) => {
  acc[key] = preset.label;
  return acc;
}, {});

const presetAreasOrder = territoryOrder;

const CUSTOM_DISTRICT_LABEL = 'Пользовательская зона';

function resolveDistrict(cellId) {
  if (!cellId) {
    return null;
  }
  return districtLookup[cellId] ?? null;
}

const defaultYear = reportingYears[reportingYears.length - 1];

const riskBands = [
  {
    id: 'stable',
    badgeClass: 'bg-emerald-500/20 text-emerald-200',
    rowClass: 'bg-emerald-500/5',
    range: '≤ 95',
    label: 'Норма расхода',
    action: 'Контроль в штатном режиме',
  },
  {
    id: 'watch',
    badgeClass: 'bg-amber-500/20 text-amber-200',
    rowClass: 'bg-amber-500/5',
    range: '95 — 110',
    label: 'Зона наблюдения',
    action: 'Сравнить с историей и уточнить датчики',
  },
  {
    id: 'alert',
    badgeClass: 'bg-orange-500/20 text-orange-200',
    rowClass: 'bg-orange-500/5',
    range: '110 — 130',
    label: 'Повышенный риск',
    action: 'Планировать выезд и поверку оборудования',
  },
  {
    id: 'critical',
    badgeClass: 'bg-rose-500/20 text-rose-200',
    rowClass: 'bg-rose-500/5',
    range: '> 130',
    label: 'Критический уровень',
    action: 'Немедленное вмешательство и уведомление служб',
  },
];

const HEXAGON_TOOLTIPS = {
  territory: {
    title: 'Как работают пресеты территорий',
    description:
      'Наборы округов (DefaultAreasConfig) содержат заранее подобранные H3-гексагоны по московским районам. При выборе пресета все ячейки сохраняются в localStorage, а в режиме ручного выделения туда же попадает состав пользовательской зоны.',
  },
  telemetry: {
    title: 'Погодная и почвенная телеметрия',
    description:
      'Интерфейс обращается к /api/polygons/{id}: бэкенд агрегирует почасовые ряды Open-Meteo в суточные значения и дополняет их архивными измерениями. Если внешнее API недоступно, вкладка использует детерминированные синтетические ряды, чтобы демонстрация оставалась целостной.',
  },
  forecasts: {
    title: 'Оценка риска расхождений',
    description:
      'backend/model.py загружает веса CatBoost и embeddings.json, объединяет их с сезонными погодными признаками (prepare_weather.py) и сортирует узлы учёта по вероятности превышения расхода ГВС.',
  },
  nodes: {
    title: 'Каталог узлов мониторинга',
    description:
      'Справочник берётся из domain/monitoringProfiles.js. Выбранные идентификаторы сохраняются локально и фильтруют ранжирование CatBoost, чтобы диспетчер видел только свои активы.',
  },
};

const HEXAGON_PARAMETER_MAPPING = [
  {
    agro: 'Поле (Field) / Гексафон',
    utility: 'МКД мониторинговый сектор (МКД + прилегающий НЗ)',
    notes: 'Используется для геопривязки показаний ИТП и ОДПУ',
  },
  {
    agro: 'Урожайность / Yield Index',
    utility: 'Баланс подач ГВС',
    notes: 'Сравнение соотношения ИТП холодной воды и ОДПУ горячей воды',
  },
  {
    agro: 'Полив / Irrigation Event',
    utility: 'Аварийное отклонение по ГВС',
    notes: 'Фиксируем список показаний после порогов 100%',
  },
  {
    agro: 'Станция мониторинга',
    utility: 'Узел учёта / ИТП',
    notes: 'Завязываем на геоузлы каталога PS000…',
  },
  {
    agro: 'Заболевания / Disease Alerts',
    utility: 'Протечки / неучтённый расход',
    notes: 'Используется в рекомендациях',
  },
  {
    agro: 'Администратор',
    utility: 'Диспетчер района МКД',
    notes: 'Формирует обратную связь и подтверждения',
  },
  {
    agro: 'Агроном',
    utility: 'Диспетчер / Аналитик ЖКХ',
    notes: 'Пользователь, принимающий решения',
  },
];

const HEXAGON_METHODOLOGY = {
  title: 'Методология геоаналитики',
  description:
    'Раскрываем, как телеметрия гексагона, погодные признаки и CatBoost формируют прогноз расхождений и рекомендации для округа.',
  sections: [
    {
      title: 'Сбор и слияние данных',
      body: [
        'API /api/polygons/{id} подтягивает почасовые ряды температуры, влажности, осадков и почвенных датчиков Open-Meteo. prepare_weather.py агрегирует их в суточные показатели, добавляет сезонные окна и связывает с H3-гексагоном через geo_key.',
        'Если Open-Meteo недоступно, используется детерминированный синтетический поток из utils/syntheticData.js, чтобы демонстрация оставалась воспроизводимой.',
      ],
    },
    {
      title: 'Соответствие терминов Agrohack ↔ Mosvodokanal',
      body: [
        'Для переиспользования катбуст-модели мы сопоставили исходные аграрные параметры с ЖКХ-аналогами. Таблица ниже показывает, как отображаются ключевые сущности и какие бизнес-заметки с ними связаны.',
      ],
      table: HEXAGON_PARAMETER_MAPPING,
    },
    {
      title: 'Ранжирование CatBoost',
      body: [
        'backend/model.py загружает weights.cbm и embeddings.json, объединяет их с агрегированными погодными признаками (prepare_weather.py) и вычисляет индекс расхождений для каталога узлов мониторинга.',
        'Результат сортируется по убыванию риска и связывается с мониторинговыми узлами из domain/monitoringProfiles.js, чтобы диспетчер мог свериться с конкретными ИТП/ОДПУ.',
      ],
    },
    {
      title: 'Управление территориями',
      body: [
        'Пресеты DefaultAreasConfig содержат подобранные гексагоны по округам. Любое ручное редактирование сохраняет состав зоны (selectedHexagons) и выбранные узлы (selectedMonitoringNodes) в localStorage, поэтому оператор возвращается к своей конфигурации.',
      ],
      list: [
        'Советы в карточке гексагона синхронизированы с диапазонами риска и помогают сформировать заявку.',
        'Источники данных явно помечены, чтобы диспетчер видел, когда используется синтетический поток.',
      ],
    },
  ],
};

function composeChartData(telemetry) {
  if (!telemetry || !Array.isArray(telemetry.labels) || telemetry.labels.length === 0) {
    return { labels: [], datasets: [] };
  }

  return {
    labels: telemetry.labels,
    datasets: [
      {
        type: 'line',
        label: 'Температура воздуха (2 м)',
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#0ea5e9',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        pointStyle: false,
        data: telemetry.temperature ?? [],
        xAxisId: 'x',
        yAxisID: 'y',
      },
      {
        type: 'bar',
        label: 'Осадки',
        borderColor: '#0284c7',
        backgroundColor: 'rgba(14, 165, 233, 0.6)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#0284c7',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        data: telemetry.rain ?? [],
        borderWidth: 2,
        xAxisId: 'x',
        yAxisID: 'y1',
      },
      {
        type: 'line',
        label: 'Относительная влажность',
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.2)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#06b6d4',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        pointStyle: false,
        data: telemetry.humidity ?? [],
        xAxisId: 'x',
        yAxisID: 'y2',
      },
      {
        type: 'line',
        label: 'Высокая облачность',
        borderColor: '#facc15',
        backgroundColor: 'rgba(250, 204, 21, 0.2)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#fde68a',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        pointStyle: false,
        data: telemetry.cloudiness ?? [],
        xAxisId: 'x',
        yAxisID: 'y3',
      },
      {
        type: 'line',
        label: 'Влажность почвы (100–255 см)',
        borderColor: '#34d399',
        backgroundColor: 'rgba(52, 211, 153, 0.18)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#10b981',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        pointStyle: false,
        data: telemetry.soilMoisture ?? [],
        xAxisId: 'x',
        yAxisID: 'y2',
      },
      {
        type: 'line',
        label: 'Температура почвы (100–255 см)',
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.18)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#c084fc',
        pointBorderColor: '#f8fafc',
        pointBorderWidth: 2,
        pointStyle: false,
        data: telemetry.soilTemperature ?? [],
        xAxisId: 'x',
        yAxisID: 'y3',
      },
    ],
  };
}

// selection code
const IDLE = 0;
const SELECTION_TYPE_DIALOG = 1;
const SELECTING_OWN_AREA = 2;

// feature toggle
// Toggle to disable filtering by selected monitoring nodes if performance drops in legacy browsers.
const USE_FILTERING_BY_NODE_SELECTION = true;

export default function GeoPage() {
  const container = useRef(null);
  const map = useRef(null);

  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const [selectedDate, setSelectedDate] = useState(() => new Date(`${defaultYear}-06-01`));
  const moscowHexGrid = useMemo(
    () => h3.polygonToCells(MOSCOW_BOUNDARY, MOSCOW_HEX_RESOLUTION, false),
    [],
  );

  const [coords] = useState([55.7558, 37.6173]);
  const [zoom] = useState(11);
  const mapState = useMemo(() => ({ center: coords, zoom }), [coords, zoom]);
  const [isInitialized, setIsInitialized] = useState(false);

  const allMonitoringNodes = useMemo(() => getAllMonitoringNodeIds(), []);

  const [territorySelectingMode, setTerritorySelectingMode] = useState(IDLE);
  const [territorySelectedLabel, setTerritorySelectedLabel] = useState(() => {
    const storedLabel = localStorage.getItem('selectedTerritoryLabel');
    if (storedLabel) {
      return storedLabel;
    }
    const hasStoredHexagons = localStorage.getItem('selectedHexagons');
    if (hasStoredHexagons) {
      return null;
    }
    return DefaultAreasLabels.centralDistrict;
  });
  const territoryCustomSelected = useRef(false);

  const [nodesSelectingMode, setNodesSelectingMode] = useState(false);
  const [selectedMonitoringNodes, setSelectedMonitoringNodes] = useState(() => {
    const item = localStorage.getItem('selectedMonitoringNodes');
    if (!item) {
      const defaults = Array.from(allMonitoringNodes);
      localStorage.setItem('selectedMonitoringNodes', JSON.stringify(defaults));
      return defaults;
    }
    try {
      const parsed = JSON.parse(item);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed;
      }
      return [];
    } catch (error) {
      console.warn('Не удалось прочитать сохранённые узлы учёта', error);
      return Array.from(allMonitoringNodes);
    }
  });

  const [selectedHexagons, setSelectedHexagons] = useState(() => {
    const stored = localStorage.getItem('selectedHexagons');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (error) {
        console.warn('Не удалось прочитать сохранённые гексафоны', error);
      }
    }
    return { ...DefaultAreasConfig.centralDistrict };
  });

  const [hexagons, setHexagons] = useState([]);
  const [hexagonInsight, setHexagonInsight] = useState(null);
  // cell hexagon format
  //{
  //  cellId: '',
  //  center: [0, 0],
  //  boundary: [],
  //  weather: { time: [], temperature_2m: [], rain: [], relative_humidity_2m: [] },
  // }
  const [currentHexagon, setCurrentHexagon] = useState(null);

  const [chartData, setChartData] = useState({ labels: [], datasets: [] });

  const [riskForecasts, setRiskForecasts] = useState([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);

  const mergeHexagonWithSynthetic = useCallback(
    (hexagon) => {
      if (!hexagon?.cellId) {
        return hexagon;
      }

      const synthetic = createSyntheticHexagonSummary(hexagon.cellId, selectedYear);
      const districtMeta = resolveDistrict(hexagon.cellId);

      return {
        ...synthetic,
        ...hexagon,
        center: hexagon.center ?? synthetic.center,
        boundary: hexagon.boundary ?? synthetic.boundary,
        districtKey: hexagon.districtKey ?? synthetic.districtKey ?? districtMeta?.key ?? null,
        districtLabel:
          hexagon.districtLabel ?? synthetic.districtLabel ?? districtMeta?.label ?? null,
        riskIndex:
          typeof hexagon.riskIndex === 'number' && !Number.isNaN(hexagon.riskIndex)
            ? hexagon.riskIndex
            : synthetic.riskIndex,
        maxRisk:
          typeof hexagon.maxRisk === 'number' && !Number.isNaN(hexagon.maxRisk)
            ? hexagon.maxRisk
            : synthetic.maxRisk,
        maxYield:
          typeof hexagon.maxYield === 'number' && !Number.isNaN(hexagon.maxYield)
            ? hexagon.maxYield
            : synthetic.maxYield,
        yield:
          typeof hexagon.yield === 'number' && !Number.isNaN(hexagon.yield)
            ? hexagon.yield
            : synthetic.yield,
        score:
          typeof hexagon.score === 'number' && !Number.isNaN(hexagon.score)
            ? hexagon.score
            : synthetic.score,
        leakProbability:
          typeof hexagon.leakProbability === 'number' && !Number.isNaN(hexagon.leakProbability)
            ? hexagon.leakProbability
            : synthetic.leakProbability,
        flowRate:
          typeof hexagon.flowRate === 'number' && !Number.isNaN(hexagon.flowRate)
            ? hexagon.flowRate
            : synthetic.flowRate,
        pressure:
          typeof hexagon.pressure === 'number' && !Number.isNaN(hexagon.pressure)
            ? hexagon.pressure
            : synthetic.pressure,
        dataset: hexagon.dataset ?? synthetic.dataset,
        status: hexagon.status ?? synthetic.status,
        advisories: hexagon.advisories ?? synthetic.advisories,
        updatedAt: hexagon.updatedAt ?? synthetic.updatedAt,
      };
    },
    [selectedYear],
  );

  const formatUpdatedAt = useCallback((value) => {
    if (!value) return null;
    try {
      return format(new Date(value), 'dd.MM.yyyy HH:mm');
    } catch (error) {
      return null;
    }
  }, []);

  const riskSummary = useMemo(() => {
    if (!riskForecasts.length) {
      return null;
    }

    const riskValues = riskForecasts.map((forecast) => forecast.riskScore);
    const max = Math.max(...riskValues);
    const min = Math.min(...riskValues);
    const avg = riskValues.reduce((acc, value) => acc + value, 0) / riskValues.length;

    return {
      max,
      min,
      avg,
    };
  }, [riskForecasts]);

  const filteredRiskForecasts = useMemo(() => {
    if (!riskForecasts.length) {
      return [];
    }

    if (!USE_FILTERING_BY_NODE_SELECTION) {
      return riskForecasts;
    }

    return riskForecasts.filter((forecast) => selectedMonitoringNodes.includes(forecast.nodeId));
  }, [riskForecasts, selectedMonitoringNodes]);

  const selectedHexagonCount = useMemo(
    () => Object.keys(selectedHexagons).length,
    [selectedHexagons],
  );

  const resolveRiskBand = useCallback((score) => {
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return null;
    }

    if (score > 130) {
      return riskBands.find((band) => band.id === 'critical');
    }
    if (score >= 110) {
      return riskBands.find((band) => band.id === 'alert');
    }
    if (score >= 95) {
      return riskBands.find((band) => band.id === 'watch');
    }
    return riskBands.find((band) => band.id === 'stable');
  }, []);

  const territoryLabel =
    territorySelectedLabel ||
    (selectedHexagonCount
      ? `${CUSTOM_DISTRICT_LABEL} (${selectedHexagonCount})`
      : 'Зона не выбрана');

  const fetchData = useCallback(async () => {
    const ids = Object.keys(selectedHexagons);
    if (!ids.length) {
      setHexagons([]);
      setCurrentHexagon(null);
      setHexagonInsight(null);
      setRiskForecasts([]);
      return;
    }

    try {
      const response = await Api.post('/polygons', {
        now: selectedDate.getTime(),
        year: selectedYear,
        ids,
      });

      const rawHexagons = Array.isArray(response.data) ? response.data : [];

      if (!rawHexagons.length) {
        const syntheticHexagons = ids.map((cellId) =>
          createSyntheticHexagonSummary(cellId, selectedYear),
        );
        setHexagons(syntheticHexagons);
        setCurrentHexagon((prev) => {
          if (!prev) {
            return syntheticHexagons[0] ?? null;
          }

          if (!ids.includes(prev.cellId)) {
            return syntheticHexagons[0] ?? null;
          }

          return prev;
        });
        return;
      }

      const mergedHexagons = rawHexagons.map((hex) => mergeHexagonWithSynthetic(hex));
      setHexagons(mergedHexagons);
      setCurrentHexagon((prev) => {
        if (!prev) {
          return mergedHexagons[0] ?? null;
        }

        if (!ids.includes(prev.cellId)) {
          return mergedHexagons[0] ?? null;
        }

        return prev;
      });
    } catch (error) {
      console.error('Не удалось загрузить данные по полигонам', error);
      const syntheticHexagons = ids.map((cellId) =>
        createSyntheticHexagonSummary(cellId, selectedYear),
      );
      setHexagons(syntheticHexagons);
      setCurrentHexagon((prev) => {
        if (!prev) {
          return syntheticHexagons[0] ?? null;
        }

        if (!ids.includes(prev.cellId)) {
          return syntheticHexagons[0] ?? null;
        }

        return prev;
      });
    }
  }, [mergeHexagonWithSynthetic, selectedDate, selectedHexagons, selectedYear]);

  const initMap = useCallback(() => {
    const ymapsApi = window?.ymaps;
    if (!ymapsApi || map.current || !container.current) {
      return;
    }

    map.current = new ymapsApi.Map(container.current, mapState);

    map.current.controls.remove('trafficControl');
    map.current.controls.remove('routeEditor');
    map.current.controls.remove('rulerControl');

    setIsInitialized(true);

    fetchData();
  }, [container, fetchData, mapState]);

  useEffect(() => {
    const ymapsApi = window?.ymaps;
    if (!ymapsApi) {
      return;
    }

    ymapsApi.ready(initMap);
  }, [initMap]);

  useEffect(() => {
    fetchData();
  }, [fetchData, territorySelectingMode]);

  useEffect(() => {
    localStorage.setItem('selectedHexagons', JSON.stringify(selectedHexagons));
  }, [selectedHexagons]);

  useEffect(() => {
    if (territorySelectedLabel) {
      localStorage.setItem('selectedTerritoryLabel', territorySelectedLabel);
    } else {
      localStorage.removeItem('selectedTerritoryLabel');
    }
  }, [territorySelectedLabel]);

  useEffect(() => {
    setSelectedDate((prev) => setYear(prev, selectedYear));
  }, [selectedYear]);

  useEffect(() => {
    if (!map.current) return;

    const ymapsApi = window?.ymaps;
    if (!ymapsApi) {
      return;
    }

    map.current.geoObjects.removeAll();

    const cells = moscowHexGrid;

    for (const cell of cells) {
      const boundary = h3.cellToBoundary(cell);

      const hex = hexagons.find((h) => h.cellId === cell);
      const isSelected = Boolean(selectedHexagons[cell]);
      const isCurrent = currentHexagon?.cellId === cell;

      const severitySource = hex
        ? [hex.riskIndex, hex.maxRisk, hex.maxYield, hex.yield, hex.score].find(
            (value) => typeof value === 'number' && !Number.isNaN(value),
          )
        : null;

      let color = 'rgba(31,169,255,0.15)';

      if (isSelected) {
        color = 'rgba(31,169,255,0.45)';

        if (typeof severitySource === 'number' && severitySource >= 130) {
          color = 'rgba(31,169,255,0.55)';
        }
      }

      if (isCurrent) {
        color = '#80FF60C7';
      }

      const polygon = new ymapsApi.Polygon(
        [boundary],
        { id: cell, hintContent: cell },
        {
          hasHint: true,
          openHintOnHover: true,
          openEmptyHint: false,
          fillColor: color,
          strokeColor: isSelected ? 'rgba(31,169,255,0.85)' : 'rgba(31,169,255,0.35)',
          strokeWidth: isSelected ? 2 : 1,
        },
      );

      polygon.events.add('click', (e) => {
        const cellId = e.originalEvent.target.properties.get('id');

        if (territorySelectingMode === SELECTING_OWN_AREA) {
          const updated = { ...selectedHexagons };
          if (updated[cellId]) {
            delete updated[cellId];
          } else {
            updated[cellId] = true;
          }

          setSelectedHexagons(updated);
        } else {
          const selectedHex = hexagons.find((h) => h.cellId === cellId) || {
            cellId,
            boundary,
            center: h3.cellToLatLng(cellId),
          };
          setCurrentHexagon(selectedHex);
        }
      });

      map.current.geoObjects.add(polygon);
    }
  }, [
    map,
    isInitialized,
    hexagons,
    territorySelectingMode,
    currentHexagon,
    moscowHexGrid,
    selectedHexagons,
  ]);

  useEffect(() => {
    if (!currentHexagon?.cellId) {
      setHexagonInsight(null);
      setRiskForecasts([]);
      setChartData(composeChartData(null));
      return;
    }

    let isCancelled = false;
    setWeatherLoading(true);
    setRiskForecasts([]);
    setChartData(composeChartData(null));
    setHexagonInsight({
      cellId: currentHexagon.cellId,
      shortId: abbreviateHexagonId(currentHexagon.cellId),
      loading: true,
      hasData: false,
      dataset: 'pending',
      advisories: [],
    });

    const fallbackBundle = createSyntheticBundle({
      cellId: currentHexagon.cellId,
      year: selectedYear,
      startTimestamp: selectedDate.getTime(),
      nodeIds: allMonitoringNodes,
    });

    const applyBundle = (bundle, options = {}) => {
      if (isCancelled) {
        return;
      }

      const { hasData = bundle.forecasts?.length > 0, sourceLabel } = options;
      const telemetry = bundle.telemetry;
      const forecasts = bundle.forecasts || [];
      const summary = bundle.summary;
      const band = resolveRiskBand(summary.riskIndex);

      setRiskForecasts(forecasts);
      setChartData(composeChartData(telemetry));
      const districtMeta = summary.districtLabel
        ? { label: summary.districtLabel, key: summary.districtKey }
        : currentHexagon?.districtLabel
          ? { label: currentHexagon.districtLabel, key: currentHexagon.districtKey }
          : resolveDistrict(summary.cellId);

      setHexagonInsight({
        cellId: summary.cellId,
        shortId: abbreviateHexagonId(summary.cellId),
        loading: false,
        hasData,
        dataset: summary.dataset,
        sourceLabel:
          sourceLabel ??
          (summary.dataset === 'open-meteo'
            ? 'Open-Meteo + прогноз HydroPulse'
            : 'Синтетическая симуляция HydroPulse'),
        districtLabel: districtMeta?.label ?? null,
        districtKey: districtMeta?.key ?? null,
        riskIndex: summary.riskIndex,
        leakProbability: summary.leakProbability,
        flowRate: summary.flowRate,
        pressure: summary.pressure,
        advisories: summary.advisories || [],
        status: summary.status ?? band?.id ?? 'stable',
        band,
        updatedAt: summary.updatedAt,
      });
    };

    const loadTelemetry = async () => {
      try {
        const response = await Api.get(`/polygons/${currentHexagon.cellId || ''}`, {
          params: { now: selectedDate.getTime(), year: selectedYear },
        });

        const { weather: backendWeather, yieldPrediction } = response.data || {};

        let forecasts = (yieldPrediction || []).map((item, index) => {
          const fallbackForecast =
            fallbackBundle.forecasts.length > 0
              ? fallbackBundle.forecasts[index % fallbackBundle.forecasts.length]
              : null;
          const nodeCandidate =
            item?.node ||
            item?.sample ||
            item?.id ||
            fallbackForecast?.nodeId ||
            allMonitoringNodes[index % allMonitoringNodes.length] ||
            `NODE-${index}`;

          const rawValue =
            typeof item?.yield === 'number'
              ? item.yield
              : typeof item?.riskScore === 'number'
                ? item.riskScore
                : typeof item?.value === 'number'
                  ? item.value
                  : null;

          if (rawValue == null || Number.isNaN(rawValue)) {
            return null;
          }

          return { nodeId: nodeCandidate, riskScore: Number(rawValue.toFixed(2)) };
        });

        forecasts = forecasts.filter(Boolean);

        if (!forecasts.length) {
          forecasts = fallbackBundle.forecasts;
        }

        const [lat, lng] = currentHexagon.center || h3.cellToLatLng(currentHexagon.cellId);

        const startDate = format(selectedDate, 'yyyy-MM-dd');
        const endDate = format(addDays(selectedDate, 6), 'yyyy-MM-dd');

        let telemetry = fallbackBundle.telemetry;
        let sourceLabel = 'Синтетическая симуляция HydroPulse';

        try {
          const meteoResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
            params: {
              latitude: lat,
              longitude: lng,
              hourly:
                'temperature_2m,relative_humidity_2m,rain,cloud_cover_high,soil_moisture_100_to_255cm,soil_temperature_100_to_255cm',
              timezone: 'Europe/Moscow',
              start_date: startDate,
              end_date: endDate,
            },
          });

          const hourly = meteoResponse.data?.hourly || {};
          if (Array.isArray(hourly.time) && hourly.time.length) {
            telemetry = {
              labels: hourly.time.map((d) => new Date(d).getTime()),
              temperature: hourly.temperature_2m || [],
              rain: hourly.rain || [],
              humidity: hourly.relative_humidity_2m || [],
              cloudiness: hourly.cloud_cover_high || [],
              soilMoisture: hourly.soil_moisture_100_to_255cm || [],
              soilTemperature: hourly.soil_temperature_100_to_255cm || [],
            };
            sourceLabel = 'Open-Meteo + прогноз HydroPulse';
          }
        } catch (meteoError) {
          if (backendWeather?.time?.length) {
            telemetry = {
              labels: backendWeather.time.map((d) => new Date(d).getTime()),
              temperature: backendWeather.temperature_2m || [],
              rain: backendWeather.rain || [],
              humidity: backendWeather.relative_humidity_2m || [],
              cloudiness: backendWeather.cloud_cover_high || [],
              soilMoisture: backendWeather.soil_moisture_100_to_255cm || [],
              soilTemperature: backendWeather.soil_temperature_100_to_255cm || [],
            };
            sourceLabel = 'Архив Open-Meteo (бэкенд) + прогноз HydroPulse';
          } else {
            console.warn('Не удалось получить погодные данные, используем синтетику', meteoError);
          }
        }

        const summary = {
          ...fallbackBundle.summary,
          riskIndex:
            forecasts.length > 0
              ? Number(
                  (
                    forecasts.reduce((acc, item) => acc + item.riskScore, 0) / forecasts.length
                  ).toFixed(2),
                )
              : fallbackBundle.summary.riskIndex,
          maxRisk:
            forecasts.length > 0
              ? Number(Math.max(...forecasts.map((item) => item.riskScore)).toFixed(2))
              : fallbackBundle.summary.maxRisk,
          dataset: sourceLabel.includes('Open-Meteo')
            ? 'open-meteo'
            : fallbackBundle.summary.dataset,
          updatedAt: new Date().toISOString(),
        };

        if (!summary.districtKey || !summary.districtLabel) {
          const meta = resolveDistrict(currentHexagon.cellId);
          summary.districtKey = summary.districtKey ?? meta?.key ?? null;
          summary.districtLabel = summary.districtLabel ?? meta?.label ?? null;
        }

        applyBundle(
          { summary, telemetry, forecasts },
          {
            hasData: forecasts.length > 0,
            sourceLabel,
          },
        );
      } catch (error) {
        console.error('Не удалось обновить телеметрию', error);
        applyBundle(fallbackBundle, {
          hasData: fallbackBundle.forecasts.length > 0,
          sourceLabel: 'Синтетическая симуляция HydroPulse (API недоступно)',
        });
      } finally {
        if (!isCancelled) {
          setWeatherLoading(false);
        }
      }
    };

    loadTelemetry();

    return () => {
      isCancelled = true;
    };
  }, [allMonitoringNodes, currentHexagon, resolveRiskBand, selectedDate, selectedYear]);

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-y-auto bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-4 text-slate-100 sm:p-6">
      <div className="grid flex-1 grid-cols-1 gap-6 xl:auto-rows-min xl:grid-cols-5">
        <section className="relative flex min-h-[540px] flex-col rounded-3xl bg-slate-900/80 shadow-2xl backdrop-blur xl:col-span-3">
          <div className="absolute inset-0">
            <div className="h-full w-full overflow-hidden rounded-3xl">
              <div id="map" className="h-full w-full" ref={container} />
            </div>
          </div>
          <div className="pointer-events-none absolute left-4 top-4 bottom-4 z-40 flex min-h-0 max-w-[26rem] flex-col gap-3 sm:max-w-[30rem] xl:max-w-[34rem]">
            <div className="pointer-events-auto rounded-2xl bg-slate-950/80 p-3 shadow-xl ring-1 ring-sky-500/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-sky-200/80">
                    <span>Активный водорайон</span>
                    <InfoTooltip
                      title={HEXAGON_TOOLTIPS.territory.title}
                      description={HEXAGON_TOOLTIPS.territory.description}
                      width="w-80"
                    />
                  </span>
                  <p className="mt-1 truncate text-sm font-semibold text-white" title={territoryLabel}>
                    {territoryLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-slate-800"
                  onClick={() => {
                    territoryCustomSelected.current = false;
                    setSelectedHexagons({ ...DefaultAreasConfig.centralDistrict });
                    setTerritorySelectedLabel(DefaultAreasLabels.centralDistrict);
                    setCurrentHexagon(null);
                    setTerritorySelectingMode(IDLE);
                    fetchData();
                  }}
                >
                  Сбросить
                </button>
              </div>
            </div>
            {hexagonInsight && (
              <div className="pointer-events-auto flex min-h-0 flex-col rounded-2xl bg-slate-950/80 p-4 shadow-xl ring-1 ring-sky-500/30">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-sky-200/80">
                      Выбранный гексафон
                    </p>
                    <p className="mt-1 text-base font-semibold text-white">
                      Сектор {hexagonInsight.shortId ?? abbreviateHexagonId(currentHexagon?.cellId)}
                    </p>
                    <p className="text-xs text-slate-400">
                      Район: {hexagonInsight.districtLabel ?? CUSTOM_DISTRICT_LABEL}
                    </p>
                  </div>
                  {hexagonInsight.band && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${hexagonInsight.band.badgeClass} break-words`}
                    >
                      {hexagonInsight.band.label}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-sky-200/60">
                  <span className="font-semibold text-sky-100">Телеметрия гексагона</span>
                  <span className="flex items-center gap-1 text-[9px] font-medium text-slate-400">
                    <span aria-hidden="true">↕</span>
                    прокрутка
                  </span>
                </div>
                <div className="relative mt-2 flex-1 rounded-xl border border-slate-800/70 bg-slate-950/50">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-6 rounded-t-xl bg-gradient-to-b from-slate-950 via-slate-950/80 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-xl bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent" />
                  <div className="relative z-10 flex-1 overflow-y-scroll px-3 py-3 pr-4 text-xs text-slate-300 [scrollbar-gutter:stable] [scrollbar-width:thin]">
                    {hexagonInsight.loading ? (
                      <p>Загружаем телеметрию…</p>
                    ) : hexagonInsight.hasData ? (
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-sky-200/70">
                              Индекс отклонения
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {typeof hexagonInsight.riskIndex === 'number'
                                ? hexagonInsight.riskIndex.toFixed(1)
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-sky-200/70">
                              Вероятность утечки
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {typeof hexagonInsight.leakProbability === 'number'
                                ? `${hexagonInsight.leakProbability.toFixed(1)}%`
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-sky-200/70">
                              Расход ГВС
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {typeof hexagonInsight.flowRate === 'number'
                                ? `${hexagonInsight.flowRate.toFixed(1)} м³/ч`
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-sky-200/70">
                              Давление
                            </p>
                            <p className="mt-1 text-lg font-semibold text-white">
                              {typeof hexagonInsight.pressure === 'number'
                                ? `${hexagonInsight.pressure.toFixed(2)} бар`
                                : '—'}
                            </p>
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-900/70 p-3">
                          <p className="text-[11px] uppercase tracking-wide text-sky-200/60">
                            Оперативные рекомендации
                          </p>
                          <ul className="mt-2 space-y-1">
                            {(hexagonInsight.advisories ?? []).map((advice) => (
                              <li key={advice} className="flex items-start gap-2">
                                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-sky-400" />
                                <span>{advice}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p>
                        Нет подтверждённых данных по этому гексафону. Используем синтетическую модель
                        HydroPulse.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>{hexagonInsight.sourceLabel ?? 'Симуляция HydroPulse'}</span>
                  {formatUpdatedAt(hexagonInsight.updatedAt) && (
                    <span>Обновлено {formatUpdatedAt(hexagonInsight.updatedAt)}</span>
                  )}
                </div>
              </div>
            )}
            {weatherLoading && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-950/70 px-3 py-2 text-xs text-sky-100/80 shadow-lg ring-1 ring-sky-500/20">
                <span className="size-2 rounded-full animate-pulse bg-amber-400" />
                <span>Обновляем данные Open-Meteo…</span>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-[440px] flex-col rounded-3xl bg-slate-900/80 p-4 text-slate-100 shadow-2xl backdrop-blur sm:p-6 xl:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-sm uppercase tracking-wide text-sky-100/80">Управление территориями</span>
              <p className="mt-1 text-xs text-slate-300">
                {territorySelectingMode === SELECTING_OWN_AREA
                  ? 'Активен ручной режим — кликайте по гексагонам на карте, чтобы добавить их.'
                  : 'Используйте предустановленные районы или сформируйте собственную зону обслуживания.'}
              </p>
            </div>
            {territorySelectingMode === SELECTING_OWN_AREA && (
              <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[10px] uppercase tracking-wider text-amber-200">
                ручной режим
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {presetAreasOrder.map((areaKey) => (
              <button
                key={areaKey}
                type="button"
                className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                  territorySelectedLabel === DefaultAreasLabels[areaKey]
                    ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
                    : 'bg-slate-800/80 text-sky-200 hover:bg-slate-800'
                }`}
                onClick={() => {
                  territoryCustomSelected.current = false;
                  setSelectedHexagons({ ...DefaultAreasConfig[areaKey] });
                  setCurrentHexagon(null);
                  setTerritorySelectedLabel(DefaultAreasLabels[areaKey]);
                  setTerritorySelectingMode(IDLE);
                }}
              >
                {DefaultAreasLabels[areaKey]}
              </button>
            ))}
            <button
              type="button"
              className={`rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                territorySelectingMode === SELECTING_OWN_AREA && territorySelectedLabel === null
                  ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
                  : 'bg-slate-800/80 text-sky-200 hover:bg-slate-800'
              }`}
              onClick={() => {
                territoryCustomSelected.current = true;
                setSelectedHexagons({});
                setCurrentHexagon(null);
                setTerritorySelectedLabel(null);
                setTerritorySelectingMode(SELECTING_OWN_AREA);
              }}
            >
              Пользовательская зона
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-sky-100/80">
              <span>Узлы мониторинга</span>
              <InfoTooltip
                title={HEXAGON_TOOLTIPS.nodes.title}
                description={HEXAGON_TOOLTIPS.nodes.description}
              />
            </div>
            <button
              type="button"
              className="rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/30"
              onClick={() => setNodesSelectingMode(true)}
            >
              {selectedMonitoringNodes.length
                ? `Выбрано ${selectedMonitoringNodes.length}`
                : 'Выбрать узлы'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Активно {selectedMonitoringNodes.length} узлов. Каталог хранится локально и привязан к профилю диспетчера.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-[10px] text-slate-400">
            <button
              type="button"
              className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-800"
              onClick={() => {
                territoryCustomSelected.current = false;
                setSelectedHexagons({ ...DefaultAreasConfig.centralDistrict });
                setTerritorySelectedLabel(DefaultAreasLabels.centralDistrict);
                setCurrentHexagon(null);
                fetchData();
              }}
            >
              Сбросить до центра
            </button>
            <button
              type="button"
              className="rounded-xl border border-sky-500/60 bg-sky-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sky-100 transition hover:bg-sky-500/30"
              onClick={() => {
                if (territorySelectingMode === SELECTING_OWN_AREA) {
                  setTerritorySelectingMode(IDLE);
                } else {
                  setTerritorySelectingMode(SELECTION_TYPE_DIALOG);
                }
              }}
            >
              {territorySelectingMode === SELECTING_OWN_AREA ? 'Завершить выделение' : 'Настроить район'}
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-6 rounded-3xl bg-slate-900/80 p-6 text-slate-100 shadow-2xl backdrop-blur xl:col-span-5">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-sky-500/20 via-cyan-500/10 to-blue-900/40 p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-2xl font-semibold text-white">HydroPulse Control</h2>
                <button
                  type="button"
                  onClick={() => setIsMethodologyOpen(true)}
                  className="rounded-full border border-sky-400/60 bg-sky-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-100 transition hover:bg-sky-500/30"
                >
                  Методология
                </button>
              </div>
              <p className="mt-2 text-sm text-sky-100/80">
                Цифровой пульт раннего обнаружения: объединяем телеметрию узлов с погодным и
                почвенным контекстом, чтобы подсветить зоны риска заранее.
              </p>
              {riskSummary && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-900/70 p-3 text-center">
                    <span className="text-xs uppercase tracking-wider text-sky-200/70">
                      Средний индекс
                    </span>
                    <p className="mt-1 text-xl font-semibold">{riskSummary.avg.toFixed(1)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/70 p-3 text-center">
                    <span className="text-xs uppercase tracking-wider text-sky-200/70">
                      Минимальный риск
                    </span>
                    <p className="mt-1 text-xl font-semibold">{riskSummary.min.toFixed(1)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/70 p-3 text-center">
                    <span className="text-xs uppercase tracking-wider text-sky-200/70">
                      Максимальный риск
                    </span>
                    <p className="mt-1 text-xl font-semibold">{riskSummary.max.toFixed(1)}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800/50 bg-slate-950/40 p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm uppercase tracking-wide text-sky-100/80">
                  Отчётный год
                </span>
                <span className="text-xs text-slate-400">Прогноз обновляется мгновенно</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {reportingYears.map((year) => {
                  const isActive = year === selectedYear;
                  return (
                    <button
                      key={year}
                      type="button"
                      className={`rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                        isActive
                          ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
                          : 'bg-slate-800/80 text-sky-200 hover:bg-slate-800'
                      }`}
                      aria-pressed={isActive}
                      onClick={() => setSelectedYear(year)}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <span className="text-sm uppercase tracking-wide text-sky-100/80">
                  Неделя анализа
                </span>
                <DatePicker
                  selected={selectedDate}
                  onChange={(value) => {
                    if (!value) return;
                    setSelectedDate(setYear(value, selectedYear));
                  }}
                  minDate={new Date(`${selectedYear}-01-01`)}
                  maxDate={new Date(`${selectedYear}-12-31`)}
                  dateFormat="dd MMMM"
                  calendarStartDay={1}
                  className="input input-bordered input-info h-11 w-full rounded-lg border-sky-600 bg-slate-950/70 text-center font-semibold text-sky-100"
                  popperPlacement="bottom"
                />
                <p className="text-xs text-slate-400">
                  Выберите дату в пределах года — модель смоделирует неделю, начиная с неё.
                </p>
              </div>
            </div>

            <div className="flex min-h-[360px] flex-col rounded-2xl border border-slate-800/50 bg-slate-950/40 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm uppercase tracking-wide text-sky-100/80">
                    Телеметрия и погодные факторы
                  </span>
                  <InfoTooltip
                    title={HEXAGON_TOOLTIPS.telemetry.title}
                    description={HEXAGON_TOOLTIPS.telemetry.description}
                  />
                </div>
                <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs uppercase tracking-wide text-sky-100">
                  Окно 7 дней
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300">
                Показания Open-Meteo и почвенных датчиков помогают оценить вероятность расхождений ГВС.
              </p>
              <div className="relative mt-4 flex-1">
                {chartData.labels.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-slate-800/60 text-center text-xs text-slate-400">
                    {weatherLoading
                      ? 'Загружаем телеметрию…'
                      : 'Выберите гексафон на карте, чтобы изучить климатические и почвенные факторы.'}
                  </div>
                )}
                <Chart
                  className="h-full"
                  type="bar"
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        labels: {
                          color: '#bae6fd',
                          font: {
                            family: 'Inter, sans-serif',
                            size: 12,
                          },
                        },
                      },
                    },
                    scales: {
                      x: {
                        type: 'time',
                        time: {
                          unit: 'day',
                          displayFormats: {
                            day: 'dd-MM-yyyy',
                          },
                        },
                        ticks: {
                          color: '#e0f2fe',
                        },
                        grid: {
                          color: 'rgba(148, 163, 184, 0.15)',
                        },
                      },
                      y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        ticks: {
                          color: '#e0f2fe',
                        },
                        grid: {
                          color: 'rgba(148, 163, 184, 0.12)',
                        },
                      },
                      y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        ticks: {
                          color: '#e0f2fe',
                        },
                        grid: {
                          drawOnChartArea: false,
                        },
                      },
                      y2: {
                        type: 'linear',
                        display: false,
                        position: 'right',
                        ticks: {
                          color: '#e0f2fe',
                        },
                      },
                      y3: {
                        type: 'linear',
                        display: false,
                        position: 'right',
                        ticks: {
                          color: '#e0f2fe',
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-6 rounded-3xl bg-slate-900/80 p-4 text-slate-100 shadow-2xl backdrop-blur sm:p-6 xl:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-white">Прогноз расхождений по узлам</h3>
                <InfoTooltip
                  title={HEXAGON_TOOLTIPS.forecasts.title}
                  description={HEXAGON_TOOLTIPS.forecasts.description}
                  width="w-80"
                />
              </div>
              <p className="text-sm text-slate-300">
                Для выбранного района, года и каталога выводим индекс риска для узлов ГВС.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs uppercase tracking-wide text-sky-100">
                {filteredRiskForecasts.length} узлов
              </span>
              <span className="text-xs text-slate-400">
                В каталоге {selectedMonitoringNodes.length} узлов
              </span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="overflow-x-auto rounded-2xl border border-slate-800/60">
              <table className="min-w-full divide-y divide-slate-800/60 text-left">
                <thead className="bg-slate-900/70 text-xs uppercase tracking-wider text-sky-100">
                  <tr>
                    <th className="px-4 py-3">Узел мониторинга</th>
                    <th className="px-4 py-3">Индекс отклонения</th>
                    <th className="px-4 py-3">Рекомендация</th>
                  </tr>
                </thead>
                <tbody className="bg-slate-950/40">
                  {filteredRiskForecasts.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-slate-400" colSpan={3}>
                        Нет данных для отображения. Измените район или выбор узлов.
                      </td>
                    </tr>
                  ) : (
                    filteredRiskForecasts.map((forecast) => {
                      const band = resolveRiskBand(forecast.riskScore);
                      return (
                        <tr
                          key={forecast.nodeId}
                          className={`transition hover:bg-sky-500/10 ${band?.rowClass ?? ''}`}
                        >
                          <td className="px-4 py-3 font-mono text-base text-white">
                            {forecast.nodeId}
                          </td>
                          <td className="px-4 py-3 text-lg font-semibold text-sky-200">
                            {forecast.riskScore.toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            {band ? (
                              <div className="flex flex-col gap-1">
                                <span
                                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${band.badgeClass}`}
                                >
                                  {band.label} · {band.range}
                                </span>
                                <span className="text-xs text-slate-200">{band.action}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">Рекомендаций нет</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-5 text-sm text-slate-200">
              <h4 className="text-base font-semibold text-white">Диапазоны риска</h4>
              <p className="text-xs text-slate-400">
                Диапазоны определяют цвета на карте и уровни рекомендаций.
              </p>
              {riskBands.map((band) => (
                <div
                  key={band.id}
                  className="rounded-xl border border-slate-800/60 bg-slate-900/70 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${band.badgeClass}`}
                    >
                      {band.label}
                    </span>
                    <span className="font-mono text-xs text-slate-300">{band.range}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{band.action}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {territorySelectingMode === SELECTION_TYPE_DIALOG && (
        <TerritorySelectionDialog
          onSelectionCode={(selectionCode) => {
            if (selectionCode && DefaultAreasConfig[selectionCode]) {
              territoryCustomSelected.current = false;
              setSelectedHexagons({ ...DefaultAreasConfig[selectionCode] });
              setCurrentHexagon(null);
              setTerritorySelectedLabel(DefaultAreasLabels[selectionCode]);
              setTerritorySelectingMode(IDLE);
              return;
            }

            territoryCustomSelected.current = true;
            setSelectedHexagons({});
            setCurrentHexagon(null);
            setTerritorySelectedLabel(null);
            setTerritorySelectingMode(SELECTING_OWN_AREA);
          }}
          closeDialog={() => {
            setTerritorySelectingMode(IDLE);
          }}
        />
      )}

      {nodesSelectingMode && (
        <MonitoringNodesDialog
          onConfirmSelection={() => {
            const newNodesSelection = fetchSelectedMonitoringNodes();
            setSelectedMonitoringNodes(newNodesSelection);
            setNodesSelectingMode(false);
          }}
          closeDialog={() => {
            setNodesSelectingMode(false);
          }}
        />
      )}
      <MethodologyModal
        title={HEXAGON_METHODOLOGY.title}
        description={HEXAGON_METHODOLOGY.description}
        sections={HEXAGON_METHODOLOGY.sections}
        open={isMethodologyOpen}
        onClose={() => setIsMethodologyOpen(false)}
      />
    </div>
  );
}

export function TerritorySelectionDialog({ onSelectionCode, closeDialog }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeDialog();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeDialog]);

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-50 flex h-full w-full items-center justify-center bg-black bg-opacity-30">
      <div ref={dialogRef} className="min-w-56 rounded-xl bg-white p-5 opacity-100 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Быстрые пресеты районов</h3>
        <p className="mt-1 text-xs text-slate-500">
          Выберите готовый кластер или очертите собственную границу на карте.
        </p>
        <div className="mt-3 grid gap-2">
          {presetAreasOrder.map((areaKey) => (
            <button
              key={areaKey}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-start text-sm font-medium text-slate-800 transition hover:bg-slate-100"
              onClick={() => onSelectionCode(areaKey)}
            >
              {DefaultAreasLabels[areaKey]}
            </button>
          ))}
        </div>
        <div className="divider">или</div>
        <button
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-start text-sm font-medium text-slate-800 transition hover:bg-slate-100"
          onClick={() => onSelectionCode(null)}
        >
          Задать район вручную на карте
        </button>
      </div>
    </div>
  );
}

export function MonitoringNodesDialog({ onConfirmSelection, closeDialog }) {
  const dialogRef = useRef(null);

  const [selectedNodes, setSelectedNodes] = useState(() => {
    return fetchSelectedMonitoringNodes();
  });
  const hoverActive = useRef(false);
  const hoverModeAdditive = useRef(false);

  const monitoringNodesTable = useMemo(() => {
    return Object.keys(monitoringProfiles)
      .sort()
      .map((nodeId) => ({
        selected: selectedNodes.includes(nodeId),
        name: nodeId,
        values: reportingYears.map((_, index) => {
          const items = monitoringProfiles[nodeId] || [];
          return items[index] ?? '-';
        }),
      }));
  }, [selectedNodes]);

  const [selectAll, setSelectAll] = useState(() => {
    return monitoringNodesTable.length === selectedNodes.length;
  });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeDialog();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeDialog]);

  const updateItemSelection = (nodeElement) => {
    let updatedNodesList;
    if (!hoverModeAdditive.current) {
      updatedNodesList = selectedNodes.filter((node) => node !== nodeElement.name);
    } else {
      updatedNodesList = [...selectedNodes, nodeElement.name];
    }

    setSelectAll(updatedNodesList.length === monitoringNodesTable.length);
    setSelectedNodes(updatedNodesList);
  };

  const helperSelectAll = () => {
    setSelectAll(!selectAll);
    if (selectAll) {
      setSelectedNodes([]);
    } else {
      setSelectedNodes(monitoringNodesTable.map((el) => el.name));
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-50 flex h-full w-full items-center justify-center bg-black bg-opacity-30">
      <div className="h-full w-full p-14">
        <div
          ref={dialogRef}
          className="relative box-border flex h-full max-h-full w-full max-w-full flex-col items-center justify-center rounded-2xl bg-slate-900 text-slate-100 shadow-2xl"
        >
          <div className="box-border flex w-full max-w-full flex-row items-center justify-between px-8">
            <span className="mt-8 pb-5 text-start font-mono text-xl text-white">
              Каталог узлов мониторинга
            </span>
            <div
              className="flex cursor-pointer flex-row items-center justify-center gap-2 rounded-xl bg-slate-800/60 px-4 py-2"
              onClick={helperSelectAll}
            >
              <span className="text-sm uppercase tracking-wide text-slate-200">
                Выбрать все узлы
              </span>
              <input
                type="checkbox"
                className="checkbox-primary size-5"
                checked={selectAll}
                onChange={helperSelectAll}
              ></input>
            </div>
          </div>

          <div className="mb-8 box-border flex w-full flex-1 justify-center overflow-auto align-middle">
            <table
              className="box-border w-4/5 table-auto border-collapse border border-slate-700/60 text-left align-middle"
              onMouseLeave={() => {
                hoverActive.current = false;
                hoverModeAdditive.current = true;
              }}
              onMouseUp={() => {
                hoverActive.current = false;
                hoverModeAdditive.current = true;
              }}
            >
              <thead>
                <tr className="bg-slate-800/80 text-slate-100">
                  <th className="border-b border-slate-700 px-4 py-2 text-sm uppercase tracking-wide">
                    Узел
                  </th>
                  {reportingYears.map((el) => (
                    <th
                      key={el}
                      className="border-b border-slate-700 px-4 py-2 text-xs uppercase tracking-wide"
                    >
                      {el}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monitoringNodesTable.map((nodeElement) => (
                  <tr
                    key={nodeElement.name}
                    className="select-none border-b border-slate-800/40 bg-slate-900/60 hover:bg-sky-500/10"
                    onMouseEnter={() => {
                      if (hoverActive.current) {
                        updateItemSelection(nodeElement);
                      }
                    }}
                    onMouseDown={() => {
                      hoverModeAdditive.current = !nodeElement.selected;
                      hoverActive.current = true;
                      updateItemSelection(nodeElement);
                    }}
                  >
                    <td className="border-r border-slate-800 px-4 py-2 text-slate-100">
                      <div className="flex flex-row items-center gap-3">
                        <input
                          type="checkbox"
                          className="checkbox-primary"
                          checked={nodeElement.selected}
                          readOnly
                        ></input>
                        <span className="font-mono text-lg text-white">{nodeElement.name}</span>
                      </div>
                    </td>
                    {nodeElement.values.map((year, index) => (
                      <td
                        key={`${nodeElement.name}-${index}`}
                        className="px-4 py-2 font-mono text-sm text-slate-200"
                      >
                        {year === '-' ? <span className="opacity-60">{year}</span> : <b>{year}</b>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex w-full flex-row items-end justify-end px-8 pb-6">
            <button
              type="button"
              className="btn btn-info btn-md rounded-lg border-0 bg-sky-500 px-6 text-white hover:bg-sky-400"
              onClick={() => {
                localStorage.removeItem('selectedMonitoringNodes');
                const items = [];
                const set = new Set(selectedNodes).values();
                for (const i of set) {
                  items.push(i);
                }
                localStorage.setItem('selectedMonitoringNodes', JSON.stringify(items));
                onConfirmSelection();
              }}
            >
              Применить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

TerritorySelectionDialog.propTypes = {
  onSelectionCode: PropTypes.func.isRequired,
  closeDialog: PropTypes.func.isRequired,
};

MonitoringNodesDialog.propTypes = {
  onConfirmSelection: PropTypes.func.isRequired,
  closeDialog: PropTypes.func.isRequired,
};

function fetchSelectedMonitoringNodes() {
  const item = localStorage.getItem('selectedMonitoringNodes');
  if (!item) return [];
  return JSON.parse(item) || [];
}
