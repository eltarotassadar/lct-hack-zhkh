import InfoTooltip from '../components/InfoTooltip.jsx';

const BUILDING_FACTORS = [
  {
    title: 'Композиция риск-индекса',
    description:
      'backend/model.py группирует telemetry.csv по МКД и году: риск = доля аномалий (>10%), максимальное отклонение и баланс подачи (ОДПУ/ИТП). Вес уверенности учитывает тренд, обратную связь диспетчера и активные факторы.',
  },
  {
    title: 'Источники телеметрии',
    description:
      'ИТП и ОДПУ загружаются из data/telemetry.csv, подтверждения инцидентов — из data/feedback.csv. Эти данные определяют статус аномалий и корректируют уверенность рекомендаций.',
  },
  {
    title: 'Погодное обогащение',
    description:
      'prepare_weather.py агрегирует почасовые ряды Open-Meteo в суточные показатели и сезонные окна, чтобы объяснять пики потребления климатом.',
  },
];

const GEO_FACTORS = [
  {
    title: 'Преднастройки округов H3',
    description:
      'Пресеты DefaultAreasConfig содержат подобранные гексагоны по округам. Любые изменения сохраняются в localStorage (selectedHexagons), чтобы оператор возвращался к своей зоне. Новый справочник покрывает восемь территорий: центр, юг, речной кластер, северные резервуары, восточный технопояс, северо-западный промышленный узел, юго-западный логистический пояс и юго-восточный энергетический контур.',
  },
  {
    title: 'Ранжирование CatBoost',
    description:
      'backend/geo.py загружает embeddings.json и weights.cbm, объединяет их с погодными признаками и формирует рейтинг узлов учёта по риску расхождений.',
  },
  {
    title: 'Погодные фолы',
    description:
      'Если Open-Meteo недоступно, вкладка использует детерминированные синтетические ряды из utils/syntheticData.js, чтобы сценарий оставался воспроизводимым.',
  },
  {
    title: 'Годы 2024–2025',
    description:
      'backend/synthetic_geo.py и utils/syntheticData.js генерируют полноценные сводки, погодные ряды и прогнозы для 2024–2025 годов. Даже без внешнего API карта, таблицы и подсказки показывают реалистичные значения — это критично для демо и офлайн-презентаций.',
  },
];

const GEO_PARAMETER_MAPPING = [
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

function MethodologyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-white">Методология</h1>
          <p className="text-sm text-slate-300">
            Разбираем, как рассчитываются показатели в диспетчерской панели и на вкладке
            геоаналитики. Используйте страницу как справочник для презентаций и обучения операторов.
          </p>
        </header>

        <section className="space-y-4 rounded-3xl border border-slate-800/60 bg-slate-900/60 p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Панель МКД</h2>
            <InfoTooltip
              title="Источники данных"
              description="telemetry.csv, feedback.csv и погодные агрегации Open-Meteo лежат в data/."
            />
          </div>
          <ul className="space-y-4 text-sm text-slate-300">
            {BUILDING_FACTORS.map((item) => (
              <li
                key={item.title}
                className="rounded-2xl border border-slate-800/60 bg-slate-900/70 p-4"
              >
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 leading-relaxed">{item.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-800/60 bg-slate-900/60 p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Geo Intelligence</h2>
            <InfoTooltip
              title="Гексагоны и прогноз"
              description="CatBoost использует embeddings.json + prepare_weather.py. Пресеты районов совпадают с вкладкой Geo."
            />
          </div>
          <ul className="space-y-4 text-sm text-slate-300">
            {GEO_FACTORS.map((item) => (
              <li
                key={item.title}
                className="rounded-2xl border border-slate-800/60 bg-slate-900/70 p-4"
              >
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 leading-relaxed">{item.description}</p>
              </li>
            ))}
          </ul>

          <div className="space-y-3 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-4">
            <h3 className="text-lg font-semibold text-white">
              Маппинг терминов Agrohack → Mosvodokanal
            </h3>
            <p className="text-sm text-slate-300">
              Чтобы переиспользовать модель Agrohack, сопоставили сущности с ЖКХ-терминами. Таблица
              ниже показывает взаимное соответствие.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800/60">
              <table className="min-w-full divide-y divide-slate-800 text-left text-xs text-slate-300">
                <thead className="bg-slate-900/80 text-slate-100">
                  <tr>
                    <th className="px-4 py-2 font-semibold uppercase tracking-wide">Agrohack</th>
                    <th className="px-4 py-2 font-semibold uppercase tracking-wide">Водоканал</th>
                    <th className="px-4 py-2 font-semibold uppercase tracking-wide">Примечание</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {GEO_PARAMETER_MAPPING.map((row) => (
                    <tr key={`${row.agro}-${row.utility}`}>
                      <td className="px-4 py-2 align-top font-medium text-slate-100">{row.agro}</td>
                      <td className="px-4 py-2 align-top">{row.utility}</td>
                      <td className="px-4 py-2 align-top">{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              Карта использует это сопоставление на всех этапах: идентификаторы узлов PS000…
              формируют CatBoost-ранжирование, показатели баланса подач переносят смысл урожайности
              Agrohack, а статусы аномалий соответствуют подсистеме «болезни/протечки». Благодаря
              унифицированным пресетам территорий и синтетическим годам 2024–2025 диспетчер видит
              согласованную историю даже при работе в офлайне.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MethodologyPage;
