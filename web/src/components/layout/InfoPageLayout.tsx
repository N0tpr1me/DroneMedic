import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const DRONE_ICON_SVG = (
  <svg className="w-7 h-7" fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.8261 17.4264C16.7203 18.1174 20.2244 18.5217 24 18.5217C27.7756 18.5217 31.2797 18.1174 34.1739 17.4264C36.9144 16.7722 39.9967 15.2331 41.3563 14.1648L24.8486 40.6391C24.4571 41.267 23.5429 41.267 23.1514 40.6391L6.64374 14.1648C8.00331 15.2331 11.0856 16.7722 13.8261 17.4264Z" fill="currentColor" />
  </svg>
);

interface InfoPageLayoutProps {
  children: ReactNode;
}

export function InfoPageLayout({ children }: InfoPageLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-bg text-on-surface font-body">
      <header className="fixed top-0 z-50 w-full border-b border-outline-variant/15 bg-bg/80 backdrop-blur-md px-6 lg:px-20 2xl:px-28 py-4 2xl:py-5">
        <div className="mx-auto flex max-w-[1440px] 2xl:max-w-[1800px] items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-3 cursor-pointer bg-transparent border-0 p-0 transition-opacity hover:opacity-80"
          >
            <div className="text-blue-300">{DRONE_ICON_SVG}</div>
            <h2 className="font-headline text-xl 2xl:text-2xl font-bold tracking-tight text-on-surface">DroneMedic</h2>
          </button>
          <nav className="hidden items-center gap-10 2xl:gap-14 md:flex">
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/">Home</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/missions">Missions</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/fleet-info">Fleet</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/technology">How It Works</Link>
            <Link className="text-sm 2xl:text-base font-medium text-on-surface-variant transition-colors hover:text-primary" to="/safety">Safety</Link>
          </nav>
          <button
            onClick={() => navigate('/login')}
            className="btn-primary-gradient flex h-11 2xl:h-13 items-center justify-center rounded px-6 2xl:px-8 text-sm 2xl:text-base font-bold tracking-wide text-white transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            Start Your First Mission
          </button>
        </div>
      </header>

      <main className="flex-1 pt-20">
        {children}
      </main>

      <footer className="border-t border-outline-variant/15 bg-surface-container-lowest py-8">
        <div className="mx-auto max-w-[1440px] 2xl:max-w-[1800px] px-6 lg:px-20 2xl:px-28 text-center text-xs 2xl:text-sm text-on-surface-variant">
          <p>&copy; 2025 DroneMedic Aerospace. All rights reserved. Precision in flight, reliability in care.</p>
        </div>
      </footer>
    </div>
  );
}
