import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { clearToken } from '../lib/auth';
import { useCurrentUser } from '../lib/useCurrentUser';
import { ThemeToggle } from './ThemeToggle';
import { Watermark } from './Watermark';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { InstallPrompt } from './InstallPrompt';
import {
  ActivityIcon,
  CameraIcon,
  CampaignsIcon,
  CloseIcon,
  ContactsIcon,
  DashboardIcon,
  HistoryIcon,
  InstancesIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from './icons';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { to: '/campaigns', label: 'Campanhas', icon: CampaignsIcon },
  { to: '/contacts', label: 'Contatos', icon: ContactsIcon },
  { to: '/instances', label: 'Instâncias', icon: InstancesIcon },
  { to: '/message-logs', label: 'Histórico', icon: HistoryIcon },
];

const adminNavItems = [
  { to: '/activity', label: 'Atividade', icon: ActivityIcon },
  { to: '/users', label: 'Usuários', icon: UsersIcon },
  { to: '/settings', label: 'Configurações', icon: SettingsIcon },
];

export function Layout() {
  const navigate = useNavigate();
  const { data: me } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function handleLogout() {
    clearToken();
    navigate('/login');
  }

  const items = me?.role === 'admin' ? [...navItems, ...adminNavItems] : navItems;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
      isActive
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
    }`;

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Watermark />

      {/* Menu lateral (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/icon.png" alt="" className="h-7 w-7 rounded-full" />
          <span className="text-base font-bold tracking-tight">DISPARA</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-3 dark:border-gray-800">
          <button
            onClick={() => setProfileOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Avatar userId={me?.id ?? ''} name={me?.name ?? '?'} avatarFilename={me?.avatarFilename} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{me?.name}</div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                {me?.role === 'admin' ? 'Administrador' : 'Usuário'}
              </div>
            </div>
          </button>
          <div className="mt-2 flex items-center justify-between px-1.5">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <LogoutIcon className="h-3.5 w-3.5" />
              Sair
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topo (mobile) */}
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 md:hidden">
          <span className="flex items-center gap-2 font-bold">
            <img src="/icon.png" alt="" className="h-7 w-7 rounded-full" />
            DISPARA
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setProfileOpen(true)}>
              <Avatar userId={me?.id ?? ''} name={me?.name ?? '?'} avatarFilename={me?.avatarFilename} size={30} />
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Abrir menu"
              className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
          </div>
        </header>

        {menuOpen && (
          <nav className="flex flex-col gap-1 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 md:hidden">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} onClick={() => setMenuOpen(false)}>
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </NavLink>
            ))}

            <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-800">
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              >
                <LogoutIcon className="h-4 w-4" />
                Sair
              </button>
            </div>
          </nav>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}

      <InstallPrompt />
    </div>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      return api.post('/auth/me/avatar', formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['current-user'] });
      setError(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Não foi possível enviar a foto.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete('/auth/me/avatar'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['current-user'] }),
  });

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    uploadMutation.mutate(file);
  }

  if (!me) return null;

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Meu perfil</h2>

      <div className="mb-4 flex flex-col items-center gap-3">
        <div className="relative">
          {preview ? (
            <img src={preview} alt="" className="h-[88px] w-[88px] rounded-full object-cover" />
          ) : (
            <Avatar userId={me.id} name={me.name} avatarFilename={me.avatarFilename} size={88} />
          )}
          <label
            htmlFor="avatar-input"
            className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
            title="Trocar foto"
          >
            <CameraIcon className="h-4 w-4" />
          </label>
          <input id="avatar-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileChange} />
        </div>

        <div className="text-center">
          <div className="font-medium text-gray-900 dark:text-gray-100">{me.name}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{me.email}</div>
        </div>

        {uploadMutation.isPending && <p className="text-xs text-gray-500 dark:text-gray-400">Enviando...</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {me.avatarFilename && (
          <button
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
          >
            Remover foto
          </button>
        )}
      </div>

      <button
        onClick={onClose}
        className="w-full rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
      >
        Fechar
      </button>
    </Modal>
  );
}
