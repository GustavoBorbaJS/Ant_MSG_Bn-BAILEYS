import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from '../lib/auth';
import { useCurrentUser } from '../lib/useCurrentUser';
import { ThemeToggle } from './ThemeToggle';
import { Watermark } from './Watermark';

const navItems = [
  { to: '/instances', label: 'Instâncias' },
  { to: '/contacts', label: 'Contatos' },
  { to: '/campaigns', label: 'Campanhas' },
  { to: '/message-logs', label: 'Histórico' },
  { to: '/dashboard', label: 'Dashboard' },
];

export function Layout() {
  const navigate = useNavigate();
  const { data: me } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    clearToken();
    navigate('/login');
  }

  const items =
    me?.role === 'admin'
      ? [
          ...navItems,
          { to: '/activity', label: 'Atividade' },
          { to: '/users', label: 'Usuários' },
          { to: '/settings', label: 'Configurações' },
        ]
      : navItems;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${
      isActive
        ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Watermark />
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="flex shrink-0 items-center gap-2 font-semibold">
            <img src="/icon.png" alt="" className="h-7 w-7 rounded-full" />
            <span className="hidden sm:inline">DISPARA</span>
          </span>

          <nav className="hidden flex-1 flex-wrap gap-1 md:flex">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {me && <span className="hidden text-sm text-gray-500 dark:text-gray-400 lg:inline">{me.name}</span>}
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="hidden text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 md:inline"
            >
              Sair
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Abrir menu"
              className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
            >
              {menuOpen ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="flex flex-col gap-1 border-t border-gray-200 px-4 py-3 dark:border-gray-800 md:hidden">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} onClick={() => setMenuOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-800">
              {me && <span className="text-sm text-gray-500 dark:text-gray-400">{me.name}</span>}
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              >
                Sair
              </button>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
