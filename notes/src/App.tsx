import { Route, Routes } from 'react-router-dom';
import SyncPill from './components/SyncPill';
import Check from './pages/Check';

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Command Centre</strong>
        <SyncPill />
      </header>
      <main>
        <Routes>
          <Route path="*" element={<Check />} />
        </Routes>
      </main>
    </div>
  );
}
