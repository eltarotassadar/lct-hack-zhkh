import { useEffect } from 'react';
import PropTypes from 'prop-types';

function MethodologyModal({ title, description, sections, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/95 p-6 text-sm text-slate-200 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-sky-500 hover:text-sky-200 focus:outline-none focus-visible:border-sky-500 focus-visible:text-sky-200"
          aria-label="Закрыть методологию"
        >
          ×
        </button>
        <h2 className="text-xl font-semibold text-white">Методология HydroPulse</h2>
        <p className="mt-3 text-slate-300">
          Этот документ описывает сквозной процесс подготовки данных, обучения логарифмической
          регрессии и интерпретации показателей, которые вы видите в интерфейсе диспетчера.
        </p>

        <section className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">Входные данные</h3>
          <p>
            Мы используем объединённые журналы из{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5">data/telemetry.csv</code>,
            <code className="ml-1 rounded bg-slate-800 px-1 py-0.5">data/feedback.csv</code> и
            погодных выборок, подготовленных скриптом{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5">backend/prepare_weather.py</code> на
            основе публичного API Open-Meteo. Для каждого МКД и года рассчитываются суточные
            показатели:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>itp_cold</strong> — объём холодной воды, поступившей через ИТП.
            </li>
            <li>
              <strong>odpu_hot</strong> — объём горячей воды, учтённый общедомовым счётчиком (ОДПУ).
            </li>
            <li>
              <strong>deviation_percent</strong> — нормализованное отклонение между потоками
              (&gt;10% сигнализирует о риске).
            </li>
            <li>
              <strong>feedback_status</strong> — метки диспетчеров, выгружаемые в CSV и
              подхватываемые при старте сервиса.
            </li>
            <li>
              <strong>weather_*</strong> — усреднённые температура, осадки и облачность для оценки
              внешнего воздействия.
            </li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">Предобработка и признаки</h3>
          <p>
            В модуле <code className="rounded bg-slate-800 px-1 py-0.5">backend/model.py</code>{' '}
            данные очищаются от пропусков, приводятся к типам и агрегируются по неделям/месяцам.
            Формируются признаки, которые затем используются моделью:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Скользящие средние и дисперсия <em>deviation_percent</em> для выявления трендов.
            </li>
            <li>
              Баланс подачи <em>supply_ratio</em> = ΣОДПУ / ΣИТП.
            </li>
            <li>
              Синтетические индикаторы погодного давления, построенные через нормализацию
              Open-Meteo.
            </li>
            <li>
              Категориальные признаки окружения (АО, район), закодированные в one-hot представление.
            </li>
            <li>
              Метки диспетчерской обратной связи, преобразованные в вероятностную корректировку.
            </li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">Логарифмическая регрессия</h3>
          <p>
            Для предсказания вероятности инцидента применяется логарифмическая регрессия (вариант
            логистической модели в логарифмическом пространстве признаков). Процесс выглядит так:
          </p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              Логарифмируем положительные количественные признаки (например, суммы потоков), чтобы
              стабилизировать влияние больших значений и подчеркнуть относительные изменения.
            </li>
            <li>
              Дополняем выборку бинарными метками «анomaly_flag», где отклонение &gt; 10% или
              инцидент подтверждён диспетчером.
            </li>
            <li>
              Обучаем модель с L2-регуляризацией, используя{' '}
              <code className="rounded bg-slate-800 px-1 py-0.5">scikit-learn</code>
              (реализация находится в пайплайне{' '}
              <code className="rounded bg-slate-800 px-1 py-0.5">training_pipeline</code>).
            </li>
            <li>
              Сохраняем коэффициенты и смещения, чтобы рассчитывать вероятность риска для каждой
              МКД/даты в режиме сервиса.
            </li>
          </ol>
            <p> 
            Также, на нашей плафторме реализована возможность ручной проверки диспетчером результатов моделирования, что позволяет улучшать модель на основе человеческой валидации.
            </p>
          <p>
            Полученное значение вероятности служит источником поля <em>confidence</em> в
            рекомендациях и влияет на сортировку таблиц.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">
            Интерпретация показателей в интерфейсе
          </h3>
          <p>Основные элементы UI напрямую связаны с описанной моделью:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Сводка МКД</strong> показывает агрегированный риск (усреднённая вероятность из
              регрессии) и максимум отклонения по журналу.
            </li>
            <li>
              <strong>График телеметрии</strong> визуализирует исходные временные ряды, на которых
              обучалась модель; цветовая шкала подчёркивает зоны с вероятностью &gt; 0.6.
            </li>
            <li>
              <strong>Рекомендации</strong> комбинируют вклад факторов (коэффициенты регрессии) и
              свежие данные, чтобы предложить действие диспетчеру.
            </li>
            <li>
              <strong>Факторы</strong> отображают, насколько каждый признак увеличивает/уменьшает
              вероятность; отключение фактора пересчитывает прогноз без соответствующего
              коэффициента.
            </li>
            <li>
              <strong>Аномалии</strong> и отметки операторов синхронизируются с CSV, что позволяет
              контролировать качество модели и уточнять пороги.
            </li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold text-white">Как обновлять модель</h3>
          <p>
            Для переобучения соберите свежие CSV, обновите{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5">data/</code> и запустите{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5">
              poetry run python backend/model.py --train
            </code>
            . Это пересоздаст веса логарифмической регрессии, а фронтенд автоматически подхватит
            новые прогнозы при следующем запуске.
          </p>
        </section>
      </div>
    </div>
  );
}

MethodologyModal.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  sections: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      body: PropTypes.arrayOf(PropTypes.string).isRequired,
      list: PropTypes.arrayOf(PropTypes.string),
      table: PropTypes.arrayOf(
        PropTypes.shape({
          agro: PropTypes.string.isRequired,
          utility: PropTypes.string.isRequired,
          notes: PropTypes.string.isRequired,
        }),
      ),
    }),
  ).isRequired,
  open: PropTypes.bool,
  onClose: PropTypes.func,
};

MethodologyModal.defaultProps = {
  open: false,
  onClose: () => {},
};

export default MethodologyModal;
