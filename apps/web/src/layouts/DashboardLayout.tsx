import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { InstallPrompt } from '../components/InstallPrompt';

export function DashboardLayout() {
  return (
    <div className="density-compact flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <InstallPrompt />
        <main className="flex-1 overflow-y-auto bg-muted/30 p-2 sm:p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
