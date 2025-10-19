import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';
import format from 'date-fns/format';
import { ru } from 'date-fns/locale';
import fallbackDataset from '../mocks/fallbackDataset.json';
import InfoTooltip from '../components/InfoTooltip.jsx';
import MethodologyModal from '../components/MethodologyModal.jsx';
import Api from '../utils/api.js';

ChartJS.register(...registerables);

const TOOLTIP_COPY = {
  summary: {
    title: 'Как формируется сводка',
    description:
      'Таблица собирается из агрегированного telemetry.csv: для каждого МКД pandas в backend/model.py группирует дневные записи по году. Риск = взвешенная сумма доли аномалий (>10% расхождения между ИТП и ОДПУ), максимального отклонения и баланса подачи (ОДПУ/ИТП).',
  },
  telemetry: {
    title: 'Источник телеметрии',
    description:
      'График строится по временным рядам из data/telemetry.csv: объёмы ИТП ХВС и ОДПУ ГВС агрегируются по дням, а отклонение рассчитывается как нормализованная разница ((ОДПУ−ИТП)/ИТП)*100 с порогом 10%.',
  },
  recommendations: {
    title: 'Как рождаются рекомендации',
    description:
      'backend/model.py вычисляет тренд отклонений и баланс подачи, затем через детерминированный генератор формирует сценарии предотвращения. Вес confidence комбинирует эвристику, последние аномалии и выбранные факторы; синтетический шум привязан к МКД и году, чтобы демонстрация оставалась воспроизводимой.',
  },
  factorPanel: {
    title: 'Факторы прогноза',
    description:
      'Каждый фактор соответствует признаку в analytics.factorCatalog. Данные берутся из telemetry.csv, feedback.csv (журнал обратной связи) и погодного API Open-Meteo: отключите ненужные признаки, чтобы пересчитать вклад в рекомендациях и увидеть, как меняется confidence.',
  },
  anomalies: {
    title: 'Откуда берутся аномалии',
    description:
      'Аномалия появляется, когда расхождение между ИТП и ОДПУ превышает 10% в исходных журналах telemetry.csv. Решения диспетчера сохраняются в data/feedback.csv, подставляются при загрузке и влияют на статус карточки. Кнопка выгрузки формирует CSV с этими полями для выбранного МКД и года.',
  },
  weather: {
    title: 'Что такое погодный фон',
    description:
      'prepare_weather.py агрегирует открытые данные Open-Meteo: из почасовых температур, осадков и облачности формируются суточные средние и суммы, чтобы диспетчер видел контекст при скачках потребления.',
  },
  fallback: {
    title: 'Оффлайн-режим',
    description:
      'Если API недоступно, фронтенд подгружает заранее собранный fallbackDataset.json, синхронизированный с telemetry_sample.json, чтобы демонстрация оставалась полной.',
  },
};

const FACTOR_TOOLTIPS = {
  deviation_trend: {
    title: 'Тренд отклонений',
    description:
      'Вычисляется как среднее по последним трём точкам deviation_ratio из telemetry.csv. Позволяет увидеть, растёт ли разрыв между ИТП и ОДПУ прямо сейчас.',
  },
  supply_ratio: {
    title: 'Баланс подачи',
    description:
      'Суммарный объём горячей воды по ОДПУ делится на суммарный объём холодной воды из ИТП за выбранный год. Значение меньше 1 сигнализирует о потерях в контуре.',
  },
  dispatcher_feedback: {
    title: 'История подтверждений',
    description:
      'Связан с журналом data/feedback.csv: туда попадают отметки диспетчеров о правдивости инцидентов. В текущем прототипе вес моделируется псевдослучайно (seed на МКД+год), чтобы показать потенциальное влияние реальной статистики.',
  },
  weather_context: {
    title: 'Погодные факторы',
    description:
      'Берётся из агрегированных рядов Open-Meteo (prepare_weather.py): температуры, осадки, облачность. Показатель отражает, насколько климатические условия могли усилить потребление.',
  },
};

const METHODOLOGY_CONTENT = {
  title: 'Методология диспетчерской панели',
  description:
    'Раскрываем цепочку данных, расчёт риска и генерацию рекомендаций, как в исходной версии панели.',
  sections: [
    {
      title: 'Входные датасеты',
      body: [
        'data/telemetry.csv агрегирует холодную (ИТП) и горячую (ОДПУ) воду по МКД и дню. data/feedback.csv хранит подтверждения и комментарии диспетчеров.',
        'prepare_weather.py соединяет почасовые ряды Open-Meteo с телеметрией, чтобы объяснять скачки потребления погодой.',
      ],
    },
    {
      title: 'Расчёт риск-индекса',
      body: [
        'backend/model.py вычисляет долю аномалий, максимальное отклонение и баланс подачи, после чего формирует сводный риск-индекс.',
        'Вес уверенности учитывает тренд отклонений, обратную связь диспетчеров и активные факторы прогноза; добавляется детерминированный шум для стабильности демонстрации.',
      ],
    },
    {
      title: 'Генерация рекомендаций',
      body: [
        'Карточки рекомендаций собираются детерминированно на основе риск-индекса, активных факторов и контекста аномалий. Экспорт CSV использует тот же пайплайн.',
      ],
    },
  ],
};

function useAsync(asyncFn, deps = []) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await asyncFn();
        if (!cancelled) {
          setState({ loading: false, data, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, data: null, error });
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function SummaryTable({ buildings, onSelect, selectedId }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <table className="min-w-full divide-y divide-slate-800">
        <thead className="bg-slate-900/80">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-400">
              МКД
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-400">
              Район
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-400">
              Риск
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-400">
              Макс. отклонение
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-400">
              Аномалии
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {buildings.map((item) => {
            const isSelected = item.mkdId === selectedId;
            return (
              <tr
                key={item.mkdId}
                className={`transition-colors hover:bg-slate-800/40 ${isSelected ? 'bg-slate-800/40' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-100">{item.mkdAddress}</div>
                  <div className="text-xs text-slate-400">
                    {item.mkdId} · ИТП {item.itpId}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-200">{item.district}</td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-amber-200">
                    {item.riskIndex.toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400">
                    Баланс подачи {(item.supplyRatio * 100).toFixed(1)}%
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-200">
                  {item.maxDeviation.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-sm text-slate-200">{item.anomalyCount}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onSelect(item.mkdId)}
                    className="rounded-lg border border-sky-500/50 px-3 py-1 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
                  >
                    Открыть
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

SummaryTable.propTypes = {
  buildings: PropTypes.arrayOf(PropTypes.object).isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedId: PropTypes.string,
};

SummaryTable.defaultProps = {
  selectedId: null,
};

function Recommendations({ bundle, enabledFactors }) {
  if (!bundle?.recommendations?.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-slate-400">
        Нет рекомендаций для выбранного года.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bundle.recommendations.map((item) => {
        const filteredFactors = item.factors.filter((factor) => enabledFactors.has(factor.id));
        return (
          <div
            key={item.code}
            className="relative rounded-xl border border-slate-800 bg-slate-900/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-100">{item.description}</p>
                <p className="text-xs text-slate-400">Code: {item.code}</p>
              </div>
              <div className="flex items-center gap-2">
                <InfoTooltip
                  title={TOOLTIP_COPY.recommendations.title}
                  description={TOOLTIP_COPY.recommendations.description}
                  width="w-80"
                />
                <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-semibold text-sky-200">
                  {Math.round(item.confidence * 100)}%
                </span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {filteredFactors.length ? (
                filteredFactors.map((factor) => (
                  <div
                    key={factor.id}
                    className="relative rounded-lg bg-slate-800/40 p-3 text-xs text-slate-300"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-100">{factor.label}</span>
                      {FACTOR_TOOLTIPS[factor.id] ? (
                        <InfoTooltip
                          title={FACTOR_TOOLTIPS[factor.id].title}
                          description={FACTOR_TOOLTIPS[factor.id].description}
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 text-slate-400">Impact: {factor.impact}%</div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-slate-800/40 p-3 text-xs text-slate-400">
                  All factors are disabled — enable at least one to compute weighting.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

Recommendations.propTypes = {
  bundle: PropTypes.object,
  enabledFactors: PropTypes.instanceOf(Set).isRequired,
};

Recommendations.defaultProps = {
  bundle: null,
};

function TelemetryChart({ telemetry }) {
  const chartData = useMemo(() => {
    if (!telemetry || !telemetry.labels?.length) {
      return { labels: [], datasets: [] };
    }

    const labels = telemetry.labels.map((ts) => format(new Date(ts), 'd MMM', { locale: ru }));

    return {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'ИТП: холодная вода',
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.2)',
          data: telemetry.itpCold,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'ОДПУ: горячая вода',
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.2)',
          data: telemetry.odpuHot,
          tension: 0.35,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Отклонение, %',
          backgroundColor: 'rgba(248, 113, 113, 0.35)',
          borderColor: '#f87171',
          data: telemetry.deviationPercent,
          yAxisID: 'y1',
        },
      ],
    };
  }, [telemetry]);

  const options = useMemo(
    () => ({
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: '#cbd5f5' },
          grid: { color: 'rgba(148, 163, 184, 0.1)' },
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: { color: '#fda4af' },
          grid: { drawOnChartArea: false },
          suggestedMax: 60,
        },
      },
      plugins: {
        legend: {
          labels: { color: '#e2e8f0' },
        },
        tooltip: {
          callbacks: {
            title(items) {
              return items[0]?.label ?? '';
            },
          },
        },
      },
    }),
    [],
  );

  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="absolute right-3 top-3">
        <InfoTooltip
          title={TOOLTIP_COPY.telemetry.title}
          description={TOOLTIP_COPY.telemetry.description}
          width="w-80"
        />
      </div>
      <Chart data={chartData} options={options} />
    </div>
  );
}

TelemetryChart.propTypes = {
  telemetry: PropTypes.shape({
    labels: PropTypes.arrayOf(PropTypes.number),
    itpCold: PropTypes.arrayOf(PropTypes.number),
    odpuHot: PropTypes.arrayOf(PropTypes.number),
    deviationPercent: PropTypes.arrayOf(PropTypes.number),
  }),
};

TelemetryChart.defaultProps = {
  telemetry: null,
};

function FactorToggles({ factors, enabledFactors, onToggle }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {factors.map((factor) => {
        const enabled = enabledFactors.has(factor.id);
        return (
          <label
            key={factor.id}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/70 bg-slate-900/40 p-3 transition hover:border-sky-500/60 ${enabled ? 'ring-1 ring-sky-500/50' : ''}`}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => onToggle(factor.id)}
              className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-800 text-sky-400 focus:ring-sky-500"
            />
            <span className="w-full">
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{factor.label}</span>
                {FACTOR_TOOLTIPS[factor.id] ? (
                  <InfoTooltip
                    title={FACTOR_TOOLTIPS[factor.id].title}
                    description={FACTOR_TOOLTIPS[factor.id].description}
                    width="w-72"
                  />
                ) : null}
              </span>
              <span className="mt-1 block text-xs text-slate-400">{factor.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

FactorToggles.propTypes = {
  factors: PropTypes.arrayOf(PropTypes.object).isRequired,
  enabledFactors: PropTypes.instanceOf(Set).isRequired,
  onToggle: PropTypes.func.isRequired,
};

function AnomalyList({ anomalies, onAction }) {
  if (!anomalies?.length) {
    return (
      <div className="relative rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-slate-400">
        <div className="absolute right-3 top-3">
          <InfoTooltip
            title={TOOLTIP_COPY.anomalies.title}
            description={TOOLTIP_COPY.anomalies.description}
            width="w-80"
          />
        </div>
        За выбранный период аномалий не зафиксировано.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {anomalies.map((anomaly) => (
        <div
          key={anomaly.id}
          className="relative rounded-xl border border-slate-800 bg-slate-900/40 p-4"
        >
          <div className="absolute right-3 top-3">
            <InfoTooltip
              title={TOOLTIP_COPY.anomalies.title}
              description={TOOLTIP_COPY.anomalies.description}
              width="w-80"
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">
                {format(new Date(anomaly.date), 'd MMMM yyyy', { locale: ru })}
              </p>
              <p className="text-xs text-slate-400">
                Отклонение: {anomaly.deviationPercent}% · ИТП {anomaly.itpCold} м³ · ОДПУ{' '}
                {anomaly.odpuHot} m³
              </p>
              {anomaly.comment ? (
                <p className="mt-1 text-xs text-amber-200">Комментарий: {anomaly.comment}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  anomaly.status === 'confirmed'
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : anomaly.status === 'dismissed'
                      ? 'bg-slate-600/30 text-slate-200'
                      : 'bg-amber-500/20 text-amber-200'
                }`}
              >
                {anomaly.status === 'unreviewed'
                  ? 'Не рассмотрено'
                  : anomaly.status === 'confirmed'
                    ? 'Подтверждено'
                    : 'Отклонено'}
              </span>
              <button
                type="button"
                onClick={() => onAction(anomaly.id, 'confirmed')}
                className="rounded-lg border border-emerald-500/50 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
              >
                Подтвердить
              </button>
              <button
                type="button"
                onClick={() => onAction(anomaly.id, 'dismissed')}
                className="rounded-lg border border-rose-500/50 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
              >
                Отклонить
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

AnomalyList.propTypes = {
  anomalies: PropTypes.arrayOf(PropTypes.object),
  onAction: PropTypes.func.isRequired,
};

AnomalyList.defaultProps = {
  anomalies: [],
};

export default function IndexPage() {
  const fallbackYears = useMemo(() => fallbackDataset.years ?? [], []);
  const fallbackBuildingsMap = useMemo(() => fallbackDataset.buildings ?? {}, []);
  const fallbackBundles = useMemo(() => fallbackDataset.bundles ?? {}, []);

  const [usingFallback, setUsingFallback] = useState(false);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMkd, setSelectedMkd] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [enabledFactors, setEnabledFactors] = useState(() => new Set());
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const yearsState = useAsync(async () => {
    try {
      const response = await Api.get('/years');
      const years = response.data.years ?? [];
      if (!years.length && fallbackYears.length) {
        setUsingFallback(true);
        return fallbackYears;
      }
      setUsingFallback(false);
      return years;
    } catch (error) {
      console.warn('Не удалось получить список лет, используем оффлайн-данные', error);
      setUsingFallback(true);
      return fallbackYears;
    }
  }, []);

  const [buildings, setBuildings] = useState([]);
  const [loadingBuildings, setLoadingBuildings] = useState(false);

  useEffect(() => {
    if (yearsState.data?.length && !selectedYear) {
      const latest = yearsState.data[yearsState.data.length - 1];
      setSelectedYear(latest);
    }
  }, [yearsState.data, selectedYear]);

  useEffect(() => {
    if (!selectedYear) return;
    let cancelled = false;
    async function load() {
      setLoadingBuildings(true);
      try {
        const response = await Api.get('/buildings', { params: { year: selectedYear } });
        if (cancelled) return;
        const fetched = response.data ?? [];
        if (fetched.length) {
          setUsingFallback(false);
          setBuildings(fetched);
        } else {
          const fallbackList = fallbackBuildingsMap[String(selectedYear)] ?? [];
          if (fallbackList.length) {
            setUsingFallback(true);
            setBuildings(fallbackList);
          } else {
            setBuildings(fetched);
          }
        }
      } catch (error) {
        console.error('Не удалось загрузить список МКД', error);
        if (cancelled) return;
        const fallbackList = fallbackBuildingsMap[String(selectedYear)] ?? [];
        if (fallbackList.length) {
          setUsingFallback(true);
          setBuildings(fallbackList);
        } else {
          setBuildings([]);
        }
      } finally {
        if (!cancelled) setLoadingBuildings(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedYear, fallbackBuildingsMap]);

  const fetchBundle = useCallback(
    async (mkdId) => {
      if (!mkdId || !selectedYear) return;
      setLoadingBundle(true);
      try {
        const response = await Api.get(`/buildings/${encodeURIComponent(mkdId)}`, {
          params: { year: selectedYear, include_weather: true },
        });
        const payload = response.data;
        setUsingFallback(false);
        setBundle(payload);
        const catalog = payload?.analytics?.factorCatalog ?? [];
        setEnabledFactors(new Set(catalog.map((factor) => factor.id)));
      } catch (error) {
        console.error('Не удалось загрузить аналитику по МКД', error);
        const fallbackKey = `${mkdId}:${selectedYear}`;
        const offlineBundle = fallbackBundles[fallbackKey];
        if (offlineBundle) {
          setUsingFallback(true);
          setBundle(offlineBundle);
          const catalog = offlineBundle?.analytics?.factorCatalog ?? [];
          setEnabledFactors(new Set(catalog.map((factor) => factor.id)));
        } else {
          setBundle(null);
        }
      } finally {
        setLoadingBundle(false);
      }
    },
    [selectedYear, fallbackBundles],
  );

  useEffect(() => {
    if (!selectedMkd) return;
    fetchBundle(selectedMkd);
  }, [fetchBundle, selectedMkd]);

  useEffect(() => {
    if (buildings.length && !selectedMkd) {
      setSelectedMkd(buildings[0].mkdId);
    }
  }, [buildings, selectedMkd]);

  const handleSelect = useCallback((mkdId) => {
    setSelectedMkd(mkdId);
  }, []);

  const handleFactorToggle = useCallback((factorId) => {
    setEnabledFactors((prev) => {
      const next = new Set(prev);
      if (next.has(factorId)) {
        next.delete(factorId);
      } else {
        next.add(factorId);
      }
      return next;
    });
  }, []);

  const handleAnomalyAction = useCallback(
    async (anomalyId, status) => {
      if (!selectedMkd) return;

      const applyLocalUpdate = (comment = null) => {
        setBundle((prev) => {
          if (!prev?.analytics?.anomalies) return prev;
          const nextAnomalies = prev.analytics.anomalies.map((item) =>
            item.id === anomalyId
              ? {
                  ...item,
                  status,
                  comment: comment ?? item.comment,
                }
              : item,
          );
          return {
            ...prev,
            analytics: {
              ...prev.analytics,
              anomalies: nextAnomalies,
            },
          };
        });
      };

      if (usingFallback) {
        applyLocalUpdate();
        return;
      }

      try {
        const response = await Api.post(`/buildings/${encodeURIComponent(selectedMkd)}/feedback`, {
          anomaly_id: anomalyId,
          status,
        });
        applyLocalUpdate(response.data.comment ?? null);
      } catch (error) {
        console.error('Не удалось обновить статус аномалии', error);
        applyLocalUpdate();
        const fallbackKey = `${selectedMkd}:${selectedYear}`;
        if (fallbackBundles[fallbackKey]) {
          setUsingFallback(true);
        }
      }
    },
    [fallbackBundles, selectedMkd, selectedYear, usingFallback],
  );

  const handleReport = useCallback(() => {
    if (!selectedMkd || !selectedYear) return;

    if (usingFallback) {
      const fallbackKey = `${selectedMkd}:${selectedYear}`;
      const offlineBundle = fallbackBundles[fallbackKey];
      const telemetry = offlineBundle?.telemetry;
      if (!telemetry) return;

      const rows = telemetry.labels.map((timestamp, index) => {
        const date = format(new Date(timestamp), 'yyyy-MM-dd');
        const cold = telemetry.itpCold?.[index] ?? '';
        const hot = telemetry.odpuHot?.[index] ?? '';
        const deviation = telemetry.deviationPercent?.[index] ?? '';
        return `${date},${cold},${hot},${deviation}`;
      });
      const csv = ['date,itp_cold,odpu_hot,deviation_percent', ...rows].join('\n');
      const blob = new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `report-${selectedMkd}-${selectedYear}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      return;
    }

    const url = `${Api.defaults.baseURL}/buildings/${encodeURIComponent(selectedMkd)}/report?year=${selectedYear}`;
    window.open(url, '_blank');
  }, [fallbackBundles, selectedMkd, selectedYear, usingFallback]);

  const handleAnomalyExport = useCallback(() => {
    if (!selectedMkd || !selectedYear) return;

    if (usingFallback) {
      const fallbackKey = `${selectedMkd}:${selectedYear}`;
      const offlineBundle = fallbackBundles[fallbackKey];
      const anomalies = offlineBundle?.analytics?.anomalies ?? [];
      const summary = offlineBundle?.summary ?? {};

      const serialize = (value) => {
        if (value === null || value === undefined) return '';
        const normalized = String(value);
        const escaped = normalized.replace(/"/g, '""');
        return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
      };

      const rows = anomalies.map((entry) => {
        const deviation =
          typeof entry.deviationPercent === 'number'
            ? entry.deviationPercent.toFixed(2)
            : (entry.deviationPercent ?? '');
        const cold =
          typeof entry.itpCold === 'number' ? entry.itpCold.toFixed(2) : (entry.itpCold ?? '');
        const hot =
          typeof entry.odpuHot === 'number' ? entry.odpuHot.toFixed(2) : (entry.odpuHot ?? '');
        const updated = entry.updatedAt ?? '';
        const comment = (entry.comment ?? '').toString().replace(/\n/g, ' ').trim();
        return [
          serialize(entry.id ?? ''),
          serialize(entry.date ?? ''),
          serialize(summary.mkdId ?? ''),
          serialize(summary.mkdAddress ?? ''),
          serialize(summary.itpId ?? ''),
          serialize(summary.odpuId ?? ''),
          serialize(summary.district ?? ''),
          serialize(deviation),
          serialize(cold),
          serialize(hot),
          serialize(entry.status ?? 'unreviewed'),
          serialize(comment),
          serialize(updated),
        ].join(',');
      });

      const header =
        'anomaly_id,date,mkd_id,mkd_address,itp_id,odpu_id,district,deviation_percent,itp_cold,odpu_hot,status,comment,updated_at';
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `anomalies-${selectedMkd}-${selectedYear}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      return;
    }

    const params = new URLSearchParams();
    if (selectedYear) {
      params.set('year', String(selectedYear));
    }
    if (selectedMkd) {
      params.set('mkd_id', String(selectedMkd));
    }
    const url = `${Api.defaults.baseURL}/anomalies/export?${params.toString()}`;
    window.open(url, '_blank');
  }, [fallbackBundles, selectedMkd, selectedYear, usingFallback]);

  const weatherSummary = bundle?.weather;
  const factors = bundle?.analytics?.factorCatalog ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">HydroPulse · Диспетчерская панель</h1>
            <p className="text-sm text-slate-400">
              Мониторим расхождения ИТП и ОДПУ, показываем рекомендации и обратную связь диспетчера.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMethodologyOpen(true)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-sky-500 hover:text-sky-200 focus:outline-none focus-visible:border-sky-500 focus-visible:text-sky-200"
              aria-haspopup="dialog"
              aria-expanded={methodologyOpen}
            >
              Методология
            </button>
            <label className="text-sm text-slate-300" htmlFor="year-select">
              Отчётный год
            </label>
            <select
              id="year-select"
              value={selectedYear ?? ''}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            >
              {(yearsState.data ?? []).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </header>

        {usingFallback ? (
          <div className="relative rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            <div className="absolute right-3 top-2">
              <InfoTooltip
                title={TOOLTIP_COPY.fallback.title}
                description={TOOLTIP_COPY.fallback.description}
                width="w-72"
              />
            </div>
            Соединение с сервером недоступно — показываем оффлайн-данные.
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Building summary</h2>
              <InfoTooltip
                title={TOOLTIP_COPY.summary.title}
                description={TOOLTIP_COPY.summary.description}
                width="w-80"
              />
            </div>
            <span className="text-xs text-slate-400">
              {loadingBuildings ? 'Загружаем список МКД…' : `${buildings.length} МКД`}
            </span>
          </div>
          <SummaryTable buildings={buildings} onSelect={handleSelect} selectedId={selectedMkd} />
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Телеметрия и рекомендации</h2>
              <button
                type="button"
                onClick={handleReport}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-sky-500 hover:text-sky-200"
              >
                Выгрузить CSV-отчёт
              </button>
            </div>
            {loadingBundle ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-slate-400">
                Загружаем показатели для выбранного МКД…
              </div>
            ) : (
              <>
                <TelemetryChart telemetry={bundle?.telemetry} />
                <Recommendations bundle={bundle} enabledFactors={enabledFactors} />
              </>
            )}
          </div>
          <aside className="space-y-6">
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-white">Факторы прогноза</h3>
                <InfoTooltip
                  title={TOOLTIP_COPY.factorPanel.title}
                  description={TOOLTIP_COPY.factorPanel.description}
                  width="w-80"
                />
              </div>
              <p className="text-xs text-slate-400">
                Управляйте параметрами, влияющими на рекомендации и уверенность.
              </p>
              <div className="mt-3">
                <FactorToggles
                  factors={factors}
                  enabledFactors={enabledFactors}
                  onToggle={handleFactorToggle}
                />
              </div>
            </div>
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-white">
                  Аномалии ({bundle?.analytics?.anomalies?.length ?? 0})
                </h3>
                <div className="flex items-center gap-2">
                  <InfoTooltip
                    title={TOOLTIP_COPY.anomalies.title}
                    description={TOOLTIP_COPY.anomalies.description}
                    width="w-80"
                  />
                  <button
                    type="button"
                    onClick={handleAnomalyExport}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-sky-500 hover:text-sky-200"
                  >
                    Выгрузить аномалии в CSV
                  </button>
                </div>
              </div>
              <AnomalyList
                anomalies={bundle?.analytics?.anomalies}
                onAction={handleAnomalyAction}
              />
            </div>
            {weatherSummary && Object.keys(weatherSummary).length ? (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold text-white">Погодный фон</h3>
                  <InfoTooltip
                    title={TOOLTIP_COPY.weather.title}
                    description={TOOLTIP_COPY.weather.description}
                    width="w-80"
                  />
                </div>
                <div className="mt-3 space-y-2 text-xs text-slate-300">
                  <p>Средняя температура: {weatherSummary.avgTemperature?.toFixed?.(1) ?? '—'}°C</p>
                  <p>Сумма осадков: {weatherSummary.totalRain?.toFixed?.(1) ?? '—'} мм</p>
                  <p>Облачность: {weatherSummary.avgCloudiness?.toFixed?.(1) ?? '—'}%</p>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </div>
      <MethodologyModal
        title={METHODOLOGY_CONTENT.title}
        description={METHODOLOGY_CONTENT.description}
        sections={METHODOLOGY_CONTENT.sections}
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
      />
    </main>
  );
}
