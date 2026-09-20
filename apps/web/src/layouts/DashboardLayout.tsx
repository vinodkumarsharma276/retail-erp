import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { InstallPrompt } from '../components/InstallPrompt';
import { usePreferencesStore } from '../stores/preferences-store';
import { cn } from '../lib/utils';

export function DashboardLayout() {
  const density = usePreferencesStore((s) => s.preferences.density);
  const { pathname } = useLocation();

  return (
    <div
      className={cn(
        'flex h-screen overflow-hidden bg-background',
        density === 'compact' && 'density-compact',
      )}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <InstallPrompt />
        {/*
         * The page container caps out at 1600px so tables don't stretch to
         * unreadable line lengths on ultrawide monitors, while still using far
         * more of a 1440p screen than the old `max-w-4xl` form pages did.
         */}
        <main className="scrollbar-auto flex-1 overflow-y-auto">
          {/*
           * Keying on pathname remounts this wrapper on every navigation,
           * which restarts the entrance animation. Without the key React
           * reuses the node and the animation only ever plays once, on the
           * first render of the session.
           */}
          <div
            key={pathname}
            className="animate-fade-in-up mx-auto w-full max-w-[100rem] px-3 py-4 sm:px-5 sm:py-5"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
