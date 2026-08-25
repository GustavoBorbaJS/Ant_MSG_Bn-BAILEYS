import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { InstanceSummary, InstanceUsage } from '../lib/api';

const STATUS_LABEL: Record<InstanceSummary['status'], string> = {
  connected: 'Conectado',
  qr_code: 'Aguardando QR',
  pairing_code: 'Aguardando código',
  connecting: 'Conectando',
  disconnected: 'Desconectado',
};

const STATUS_COLOR: Record<InstanceSummary['status'], string> = {
  connected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  qr_code: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  pairing_code: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  connecting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  disconnected: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const WARMUP_COLOR: Record<InstanceSummary['warmupLevel'], string> = {
  cold: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  warm: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  hot: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

export function InstancesPage() {
  const queryClient = useQueryClient();
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [newInstanceId, setNewInstanceId] = useState('');

  const { data: instances, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
    refetchInterval: 5000,
  });

  const reconnectMutation = useMutation({
    mutationFn: (instanceId: string) => api.post(`/instances/${instanceId}/reconnect`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível reconectar essa instância.'),
  });

  const resetMutation = useMutation({
    mutationFn: (instanceId: string) => api.delete(`/instances/${instanceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível limpar a sessão dessa instância.'),
  });

  function startPairing(instanceId: string) {
    setPairingId(instanceId);
  }

  function handleReset(instanceId: string) {
    if (
      confirm(
        `Limpar a sessão de "${instanceId}"? O WhatsApp desconectado ficará desvinculado - vai precisar escanear um QR code novo pra reconectar.`,
      )
    ) {
      resetMutation.mutate(instanceId);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instâncias</h1>
        <div className="flex flex-wrap gap-2">
          <input
            value={newInstanceId}
            onChange={(e) => setNewInstanceId(e.target.value)}
            placeholder="ex: 5511999999999"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:flex-none"
          />
          <button
            disabled={!newInstanceId}
            onClick={() => startPairing(newInstanceId)}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
          >
            Parear nova instância
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Instância</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Aquecimento</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {instances?.map((instance) => (
              <tr key={instance.instanceId} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-4 py-2 font-mono text-gray-900 dark:text-gray-100">{instance.instanceId}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[instance.status]}`}>
                    {STATUS_LABEL[instance.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${WARMUP_COLOR[instance.warmupLevel]}`}>
                    {instance.warmupLevel}
                  </span>
                  {instance.warmupAgeDays !== null && (
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                      {instance.warmupAgeDays.toFixed(1)}d
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => startPairing(instance.instanceId)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Parear
                  </button>
                  <button
                    onClick={() => reconnectMutation.mutate(instance.instanceId)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Reconectar
                  </button>
                  <button
                    onClick={() => handleReset(instance.instanceId)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Limpar sessão
                  </button>
                </td>
              </tr>
            ))}
            {instances?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhuma instância ainda. Pareie a primeira acima.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pairingId && <PairingDialog instanceId={pairingId} onClose={() => setPairingId(null)} />}
    </div>
  );
}

type PairingMethod = 'qr' | 'code';

function formatPairingCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function PairingDialog({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<PairingMethod | null>(null);
  const [phoneNumber, setPhoneNumber] = useState(() => instanceId.replace(/\D/g, ''));
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data: usage } = useQuery({
    queryKey: ['instance-usage', instanceId],
    queryFn: async () => (await api.get<InstanceUsage>(`/instances/${instanceId}/usage`)).data,
    refetchInterval: 5000,
  });

  const connectMutation = useMutation({
    mutationFn: (body?: { phoneNumber: string }) => api.post(`/instances/${instanceId}/connect`, body),
    onError: (err: any) => {
      setCodeError(err.response?.data?.message || 'Não foi possível iniciar o pareamento.');
      setMethod(null);
    },
  });

  const { data: status } = useQuery({
    queryKey: ['instance-status', instanceId],
    queryFn: async () =>
      (await api.get<{ status: string; qr?: string; pairingCode?: string }>(`/instances/${instanceId}/status`)).data,
    enabled: connectMutation.isPending || connectMutation.isSuccess,
    // QR/codigo do WhatsApp expiram rápido e o Baileys gera outro sozinho -
    // repolling curto mantém sempre válido na tela
    refetchInterval: (query) => (query.state.data?.status === 'connected' ? false : 3000),
  });

  if (status?.status === 'connected') {
    queryClient.invalidateQueries({ queryKey: ['instances'] });
  }

  function chooseQr() {
    setCodeError(null);
    setMethod('qr');
    connectMutation.mutate(undefined);
  }

  function requestCode(e: FormEvent) {
    e.preventDefault();
    setCodeError(null);
    setMethod('code');
    connectMutation.mutate({ phoneNumber });
  }

  function backToMethodChoice() {
    setMethod(null);
    setCodeError(null);
    // limpa isPending/data da tentativa anterior - senao trocar de QR pra
    // código (ou vice-versa) pulava direto pra tela de espera com o estado
    // velho, sem deixar digitar o telefone de novo
    connectMutation.reset();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-80 rounded-lg bg-white p-6 text-center shadow-lg dark:bg-gray-900">
        <h2 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">{instanceId}</h2>

        {method === null && (
          <>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Como prefere conectar?</p>
            <div className="mb-2 flex gap-2">
              <button
                onClick={chooseQr}
                className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                QR code
              </button>
              <button
                onClick={() => setMethod('code')}
                className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Código
              </button>
            </div>
          </>
        )}

        {method === 'code' && !connectMutation.isPending && !connectMutation.data && (
          <form onSubmit={requestCode} className="text-left">
            <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Número (com DDI/DDD)</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
              required
              placeholder="ex: 5511999999999"
              className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={backToMethodChoice}
                className="flex-1 rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
              >
                Voltar
              </button>
              <button
                type="submit"
                className="flex-1 rounded-md bg-gray-900 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
              >
                Gerar código
              </button>
            </div>
          </form>
        )}

        {method !== null && (connectMutation.isPending || connectMutation.data) && (
          <>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              {status?.status === 'connected'
                ? 'Conectado!'
                : method === 'qr'
                  ? 'Escaneie com WhatsApp → Aparelhos conectados'
                  : 'No WhatsApp: Aparelhos conectados → Conectar com número de telefone → digite o código abaixo'}
            </p>

            {status?.status === 'connected' && <div className="py-8 text-4xl">✅</div>}

            {method === 'qr' && status?.qr && status.status !== 'connected' && (
              <img
                src={status.qr}
                alt="QR code"
                className="mx-auto mb-2 w-56 rounded-md border border-gray-200 dark:border-gray-700"
              />
            )}

            {method === 'code' && status?.pairingCode && status.status !== 'connected' && (
              <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 py-4 font-mono text-2xl font-semibold tracking-widest text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                {formatPairingCode(status.pairingCode)}
              </div>
            )}

            {status?.status !== 'connected' && !status?.qr && !status?.pairingCode && (
              <p className="py-8 text-sm text-gray-400 dark:text-gray-500">
                {method === 'qr' ? 'Gerando QR...' : 'Gerando código...'}
              </p>
            )}

            {status?.status !== 'connected' && (
              <button
                onClick={backToMethodChoice}
                className="mb-2 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                Trocar método
              </button>
            )}
          </>
        )}

        {codeError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{codeError}</p>}

        {usage && (
          <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
            nível {usage.warmupLevel} · {usage.used.day}/{usage.limits.perDay} hoje
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
