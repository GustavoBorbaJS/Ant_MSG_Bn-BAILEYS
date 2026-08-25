import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { InstanceSummary } from '../lib/api';
import { TestTubeIcon } from '../components/icons';

export function TestDispatchPage() {
  const [instanceId, setInstanceId] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [burstCount, setBurstCount] = useState(5);
  const [aggressive, setAggressive] = useState(false);
  const [acknowledgeAggressiveRisk, setAcknowledgeAggressiveRisk] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data: instances, isLoading: loadingInstances } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      api.post<{ sentCount: number; burstCount: number; aggressive: boolean }>('/test-dispatch', {
        instanceId,
        to,
        text: text.trim() || undefined,
        burstCount,
        aggressive,
        acknowledgeAggressiveRisk: aggressive ? acknowledgeAggressiveRisk : undefined,
      }),
    onSuccess: (res) =>
      setResult({
        ok: true,
        message: res.data.aggressive
          ? `${res.data.sentCount}/${res.data.burstCount} mensagens enviadas durante o conflito de sessão forçado. Confira no celular do destinatário e o status da instância (pode ter caído/precisar reparear).`
          : `${res.data.sentCount}/${res.data.burstCount} mensagens da rajada foram enviadas. Confira no celular do destinatário quais carregaram normalmente.`,
      }),
    onError: (err: any) =>
      setResult({ ok: false, message: err.response?.data?.message || 'Não foi possível completar o disparo de teste.' }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    dispatchMutation.mutate();
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
          <TestTubeIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Disparo de teste</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Acesso exclusivo - ferramenta de diagnóstico</p>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900 dark:border-purple-900/50 dark:bg-purple-900/20 dark:text-purple-300">
        Isso reconecta a instância escolhida e dispara a rajada de mensagens <strong>imediatamente</strong> em
        seguida, fora do fluxo normal de disparo (sem fila, sem delay) - tenta reproduzir o "não foi possível
        carregar a mensagem" do WhatsApp. Sem garantia de reprodução (é uma corrida de protocolo fora do nosso
        controle). Use só pra estudo/diagnóstico, não com contatos reais de campanha.
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Instância</label>
        <select
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="" disabled>
            {loadingInstances ? 'Carregando...' : 'Selecione uma instância'}
          </option>
          {instances?.map((instance) => (
            <option key={instance.instanceId} value={instance.instanceId}>
              {instance.instanceId} ({instance.status})
            </option>
          ))}
        </select>

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Número (com DDI/DDD)</label>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
          placeholder="ex: 5511999999999"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Mensagem (opcional)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Deixe em branco pra usar a mensagem de teste padrão"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">
          Tamanho da rajada <span className="text-gray-400 dark:text-gray-500">(mensagens seguidas, 1-20)</span>
        </label>
        <input
          type="number"
          min={1}
          max={20}
          value={burstCount}
          onChange={(e) => setBurstCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-4 flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={aggressive}
            onChange={(e) => {
              setAggressive(e.target.checked);
              setAcknowledgeAggressiveRisk(false);
            }}
            className="mt-0.5"
          />
          <span>
            Modo agressivo <span className="text-gray-400 dark:text-gray-500">(força conflito de sessão)</span>
          </span>
        </label>

        {aggressive && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            <p className="mb-2 font-medium">Isso é destrutivo.</p>
            <p className="mb-3">
              Abre uma segunda conexão concorrente na mesma sessão de propósito, forçando o WhatsApp a tratar como
              "mesmo dispositivo logando em outro lugar". A instância precisa já estar <strong>conectada</strong> antes
              de disparar - pode cair, ficar instável, ou exigir reparear depois. Só use numa instância de teste, não
              numa em produção.
            </p>
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={acknowledgeAggressiveRisk}
                onChange={(e) => setAcknowledgeAggressiveRisk(e.target.checked)}
                className="mt-0.5"
              />
              Confirmo que entendo o risco e aceito que a instância pode precisar reparear depois.
            </label>
          </div>
        )}

        {result && (
          <p
            className={`mb-4 text-sm ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {result.message}
          </p>
        )}

        <button
          type="submit"
          disabled={dispatchMutation.isPending || !instanceId || (aggressive && !acknowledgeAggressiveRisk)}
          className={`w-full rounded-md py-2 text-sm font-medium text-white disabled:opacity-50 ${
            aggressive ? 'bg-red-600' : 'bg-purple-600'
          }`}
        >
          {dispatchMutation.isPending ? 'Disparando...' : aggressive ? 'Disparar teste agressivo' : 'Disparar teste'}
        </button>
      </form>
    </div>
  );
}
