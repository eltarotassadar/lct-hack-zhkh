import PropTypes from 'prop-types';

function InfoTooltip({ title, description, width }) {
  return (
    <div className="group relative inline-flex overflow-visible">
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 text-[10px] font-semibold text-slate-300 transition hover:border-sky-500 hover:text-sky-200 focus:outline-none focus-visible:border-sky-500 focus-visible:text-sky-200"
        aria-label={title}
      >
        i
      </button>
      <div
        className={`pointer-events-none absolute right-0 top-6 z-[200] hidden ${
          width || 'w-72'
        } rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-left text-xs leading-relaxed text-slate-200 shadow-xl group-focus-within:block group-hover:block`}
      >
        <p className="font-semibold text-slate-100">{title}</p>
        <p className="mt-1 whitespace-pre-line text-slate-300">{description}</p>
      </div>
    </div>
  );
}

InfoTooltip.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  width: PropTypes.string,
};

InfoTooltip.defaultProps = {
  width: 'w-72',
};

export default InfoTooltip;
