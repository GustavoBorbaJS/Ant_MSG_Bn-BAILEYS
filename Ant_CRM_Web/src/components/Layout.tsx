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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Watermark />
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="flex items-center gap-2 font-semibold">
            <img src="/icon.png" alt="" className="h-7 w-7 rounded-full" />
            CRM local
          </span>
          <nav className="flex gap-1">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me && <span className="text-sm text-gray-500 dark:text-gray-400">{me.name}</span>}
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
