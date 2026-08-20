import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AntibanConfig, WarmupLevel } from '../lib/api';

const LEVEL_LABEL: Record<WarmupLevel, string> = { cold: 'Frio', warm: 'Morno', hot: 'Quente' };
const LEVEL_HINT: Record<WarmupLevel, string> = {
  cold: 'Instância recém pareada, ainda sem histórico de aquecimento.',
  warm: 'Já passou dos dias de aquecimento mínimo.',
  hot: 'Aquecida (ou marcada como confiável) — maior limite de envio.',
};

function toNumber(value: string): number {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AntibanConfig | null>(null);
  const [trustedInput, setTrustedInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'antiban'],
    queryFn: async () => (await api.get<AntibanConfig>('/settings/antiban')).data,
  });

  useEffect(() => {
    if (data && !form) {
      setForm(data);
      setTrustedInput(data.trustedInstances.join(', '));
    }
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (config: AntibanConfig) => api.put('/settings/antiban', config),
    onSuccess: (res) => {
      queryClient.setQueryData(['settings', 'antiban'], res.data);
      setForm(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: any) =>
      setError(err.response?.data?.message?.toString?.() || 'Não foi possível salvar as configurações.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    saveMutation.mutate({
      ...form,
      trustedInstances: trustedInput
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    });
  }

  function updateLevel(level: WarmupLevel, field: 'perMinute' | 'perHour' | 'perDay', value: string) {
    if (!form) return;
    setForm({
      ...form,
      limits: { ...form.limits, [level]: { ...form.limits[level], [field]: toNumber(value) } },
    });
  }

  if (isLoading || !form) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>;
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Configurações de anti-ban</h1>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Ajusta os limites de disparo por número em tempo real, sem precisar reiniciar nada. O worker lê essa
        configuração a cada verificação — os limites continuam sendo aplicados normalmente, só os valores mudam.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2">Nível de aquecimento</th>
                <th className="px-4 py-2">Por minuto</th>
                <th className="px-4 py-2">Por hora</th>
                <th className="px-4 py-2">Por dia</th>
              </tr>
            </thead>
            <tbody>
              {(['cold', 'warm', 'hot'] as WarmupLevel[]).map((level) => (
                <tr key={level} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{LEVEL_LABEL[level]}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{LEVEL_HINT[level]}</div>
                  </td>
                  {(['perMinute', 'perHour', 'perDay'] as const).map((field) => (
                    <td key={field} className="px-4 py-2">
                      <input
                        type="number"
                        min={1}
                        value={form.limits[level][field]}
                        onChange={(e) => updateLevel(level, field, e.target.value)}
                        required
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
              Dias até virar "morno"
            </label>
            <input
              type="number"
              min={0}
              value={form.warmupDaysToWarm}
              onChange={(e) => setForm({ ...form, warmupDaysToWarm: toNumber(e.target.value) })}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
              Dias até virar "quente"
            </label>
            <input
              type="number"
              min={0}
              value={form.warmupDaysToHot}
              onChange={(e) => setForm({ ...form, warmupDaysToHot: toNumber(e.target.value) })}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
            Limite diário global (soma de todos os números)
          </label>
          <input
            type="number"
            min={1}
            value={form.globalDailyLimit}
            onChange={(e) => setForm({ ...form, globalDailyLimit: toNumber(e.target.value) })}
            required
            className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div className="mb-6">
          <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
            Instâncias confiáveis (sempre tratadas como "quente", separadas por vírgula)
          </label>
          <input
            value={trustedInput}
            onChange={(e) => setTrustedInput(e.target.value)}
            placeholder="ex: 84999321588"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && <p className="mb-4 text-sm text-green-600 dark:text-green-400">Configuração salva.</p>}

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
        >
          {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </div>
  );
}
