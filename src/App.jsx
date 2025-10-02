import './App.css';
import { Outlet } from 'react-router-dom';

function App() {
  return (
    <>
      <div className="navbar-center bg-gradient-to-r from-slate-900 via-sky-900 to-cyan-900 text-slate-100 shadow-lg">
          <a className="btn btn-ghost text-xl normal-case tracking-wide text-sky-100">
            HydroPulse Insight
          </a>
      </div>
      <main className="h-[calc(100%-64px)] w-full p-2">
        <Outlet />
      </main>
    </>
  );
}

export default App;
