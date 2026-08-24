import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CrmUser } from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/Avatar';

const ROLE_LABEL: Record<CrmUser['role'], string> = { admin: 'Administrador', user: 'Usuário' };
const ROLE_COLOR: Record<CrmUser['role'], string> = {
  admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  user: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [creating, setCreating] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<{ username: string; password: string } | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<CrmUser[]>('/users')).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível remover.'),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (user: CrmUser) => api.post(`/users/${user.id}/reset-password`).then((res) => ({ user, res })),
    onSuccess: ({ user, res }) => setRevealedPassword({ username: user.username, password: res.data.password }),
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/users/${id}/active`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível alterar o status do usuário.'),
  });

  const setCanDispatchTestMutation = useMutation({
    mutationFn: ({ id, canDispatchTest }: { id: string; canDispatchTest: boolean }) =>
      api.patch(`/users/${id}`, { canDispatchTest }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível alterar a permissão de disparo de teste.'),
  });

  function handleDelete(user: CrmUser) {
    if (confirm(`Remover o usuário "${user.name}"?`)) {
      deleteMutation.mutate(user.id);
    }
  }

  function handleToggleActive(user: CrmUser) {
    const action = user.active ? 'bloquear' : 'desbloquear';
    const warning = user.active ? ' Os disparos feitos por ele no CRM serão interrompidos imediatamente.' : '';
    if (confirm(`Deseja ${action} o usuário "${user.name}"?${warning}`)) {
      setActiveMutation.mutate({ id: user.id, active: !user.active });
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Usuários</h1>
        <button
          onClick={() => setCreating(true)}
          className="self-start rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900 sm:self-auto"
        >
          Novo usuário
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Usuário</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Papel</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Disparo de teste</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => (
              <tr
                key={user.id}
                className={`border-t border-gray-100 dark:border-gray-800 ${!user.active ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar userId={user.id} name={user.name} avatarFilename={user.avatarFilename} size={26} />
                    <span className="text-gray-900 dark:text-gray-100">{user.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{user.username}</td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{user.email}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLOR[user.role]}`}>
                    {ROLE_LABEL[user.role]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.active
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                    }`}
                  >
                    {user.active ? 'Ativo' : 'Bloqueado'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {user.role === 'admin' ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Sempre (admin)</span>
                  ) : (
                    <button
                      onClick={() =>
                        setCanDispatchTestMutation.mutate({ id: user.id, canDispatchTest: !user.canDispatchTest })
                      }
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.canDispatchTest
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                      title="Permite usar o disparo de teste exclusivo (reconecta a instância e envia na hora)"
                    >
                      {user.canDispatchTest ? 'Liberado' : 'Bloqueado'}
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleToggleActive(user)}
                    disabled={user.id === me?.id && user.active}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:text-gray-100"
                    title={user.id === me?.id && user.active ? 'Você não pode bloquear a própria conta' : undefined}
                  >
                    {user.active ? 'Bloquear' : 'Desbloquear'}
                  </button>
                  <button
                    onClick={() => resetPasswordMutation.mutate(user)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Gerar nova senha
                  </button>
                  <button
                    onClick={() => handleDelete(user)}
                    disabled={user.id === me?.id}
                    className="text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-400 dark:hover:text-red-300"
                    title={user.id === me?.id ? 'Você não pode remover a própria conta' : undefined}
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {users?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhum usuário ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(username, password) => {
            setCreating(false);
            setRevealedPassword({ username, password });
          }}
        />
      )}

      {revealedPassword && (
        <PasswordRevealModal
          username={revealedPassword.username}
          password={revealedPassword.password}
          onClose={() => setRevealedPassword(null)}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (username: string, password: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => api.post('/users', { name, username, email, role }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onCreated(username, res.data.password);
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Não foi possível criar o usuário.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    createMutation.mutate();
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Novo usuário</h2>

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Usuário (login)</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="ex: joao.silva"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Papel</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="user">Usuário</option>
          <option value="admin">Administrador</option>
        </select>

        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 rounded-md bg-gray-900 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {createMutation.isPending ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordRevealModal({
  username,
  password,
  onClose,
}: {
  username: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">Senha gerada</h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Compartilhe com <span className="font-mono">{username}</span> agora — essa senha não vai aparecer de novo.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
        <span className="flex-1 font-mono text-sm text-gray-900 dark:text-gray-100">{password}</span>
        <button
          onClick={copy}
          className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
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
