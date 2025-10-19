import './App.css';
import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Панель МКД' },
  { to: '/geo', label: 'Геоаналитика' },
  { to: '/methodology', label: 'Методология' },
];

function App() {
  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between bg-gradient-to-r from-slate-900 via-sky-900 to-cyan-900 px-6 py-4 shadow-lg">
        <span className="text-xl font-semibold tracking-wide text-sky-100">HydroPulse Insight</span>
        <nav className="flex gap-2 text-sm">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                  isActive
                    ? 'bg-sky-300/20 text-sky-100 shadow-inner shadow-sky-500/30'
                    : 'text-slate-200 hover:bg-sky-400/10 hover:text-sky-100'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
