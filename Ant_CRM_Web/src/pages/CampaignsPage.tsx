import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, Contact, InstanceSummary, Paginated } from '../lib/api';
import { Modal } from '../components/Modal';

export function CampaignsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [dispatching, setDispatching] = useState<Campaign | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get<Campaign[]>('/campaigns')).data,
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  function handleDelete(campaign: Campaign) {
    if (confirm(`Remover a campanha "${campaign.name}"?`)) {
      deleteMutation.mutate(campaign.id);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Campanhas</h1>
        <button
          onClick={() => setEditing('new')}
          className="self-start rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900 sm:self-auto"
        >
          Nova campanha
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="space-y-3">
        {campaigns?.map((campaign) => {
          const total = campaign.progress.pending + campaign.progress.sent + campaign.progress.failed;
          const sentPct = total ? (campaign.progress.sent / total) * 100 : 0;
          const failedPct = total ? (campaign.progress.failed / total) * 100 : 0;

          return (
            <div
              key={campaign.id}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{campaign.name}</h3>
                  <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">{campaign.text}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => setDispatching(campaign)}
                    className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                  >
                    Disparar
                  </button>
                  <button
                    onClick={() => setEditing(campaign)}
                    className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(campaign)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Remover
                  </button>
                </div>
              </div>

              {total > 0 && (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="flex h-full">
                      <div className="bg-green-500" style={{ width: `${sentPct}%` }} />
                      <div className="bg-red-500" style={{ width: `${failedPct}%` }} />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {campaign.progress.sent} enviadas · {campaign.progress.failed} falharam ·{' '}
                    {campaign.progress.pending} pendentes (de {total})
                  </p>
                </>
              )}
            </div>
          );
        })}

        {campaigns?.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
            Nenhuma campanha ainda.
          </p>
        )}
      </div>

      {editing && <CampaignFormModal campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {dispatching && <DispatchModal campaign={dispatching} onClose={() => setDispatching(null)} />}
    </div>
  );
}

function CampaignFormModal({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(campaign?.name ?? '');
  const [text, setText] = useState(campaign?.text ?? '');
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      campaign ? api.patch(`/campaigns/${campaign.id}`, { name, text }) : api.post('/campaigns', { name, text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
    onError: () => setError('Não foi possível salvar.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">
          {campaign ? 'Editar campanha' : 'Nova campanha'}
        </h2>

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Mensagem</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          rows={4}
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

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
            disabled={saveMutation.isPending}
            className="flex-1 rounded-md bg-gray-900 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function parseBatchSizes(input: string): number[] {
  return input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function DispatchModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [instanceId, setInstanceId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'auto' | 'direct'>('auto');
  const [batchSizesInput, setBatchSizesInput] = useState('');
  const [batchIntervalMinutes, setBatchIntervalMinutes] = useState('5');
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
  });

  const { data: contactsPage } = useQuery({
    queryKey: ['contacts', ''],
    queryFn: async () => (await api.get<Paginated<Contact>>('/contacts', { params: { pageSize: 5000 } })).data,
  });

  const dispatchMutation = useMutation({
    mutationFn: () => {
      const contactIds = Array.from(selectedIds);
      const batchSizes = mode === 'direct' ? parseBatchSizes(batchSizesInput) : [];
      return api.post(`/campaigns/${campaign.id}/dispatch`, {
        instanceId,
        contactIds,
        mode,
        acknowledgeRisk: mode === 'direct' ? true : undefined,
        batchSizes: mode === 'direct' && batchSizes.length > 0 ? batchSizes : undefined,
        batchIntervalMinutes: mode === 'direct' && batchSizes.length > 1 ? Number(batchIntervalMinutes) : undefined,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setResult(`${res.data.dispatched} mensagem(ns) enfileirada(s).`);
      setError(null);
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Não foi possível disparar.'),
  });

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allContactsSelected = !!contactsPage?.items.length && contactsPage.items.every((c) => selectedIds.has(c.id));

  function toggleAll() {
    if (allContactsSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contactsPage?.items.map((c) => c.id) ?? []));
    }
  }

  const connectedInstances = instances?.filter((i) => i.status === 'connected') ?? [];

  const batchSizes = parseBatchSizes(batchSizesInput);
  const batchSum = batchSizes.reduce((a, b) => a + b, 0);
  const batchSumMatches = batchSizesInput.trim() === '' || batchSum === selectedIds.size;

  const canSubmit =
    !!instanceId &&
    selectedIds.size > 0 &&
    !dispatchMutation.isPending &&
    batchSumMatches &&
    (mode === 'auto' || acknowledgeRisk);

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">Disparar "{campaign.name}"</h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{campaign.text}</p>

      <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Instância</label>
      <select
        value={instanceId}
        onChange={(e) => setInstanceId(e.target.value)}
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="">Selecione...</option>
        {connectedInstances.map((i) => (
          <option key={i.instanceId} value={i.instanceId}>
            {i.instanceId} ({i.warmupLevel})
          </option>
        ))}
      </select>

      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm text-gray-600 dark:text-gray-400">
          Contatos ({selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'})
        </label>
        {!!contactsPage?.items.length && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={allContactsSelected} onChange={toggleAll} />
            Selecionar todos
          </label>
        )}
      </div>
      <div className="mb-4 max-h-48 overflow-y-auto rounded-md border border-gray-300 dark:border-gray-700">
        {contactsPage?.items.map((contact) => (
          <label
            key={contact.id}
            className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-sm last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
          >
            <input type="checkbox" checked={selectedIds.has(contact.id)} onChange={() => toggle(contact.id)} />
            <span className="text-gray-900 dark:text-gray-100">{contact.name}</span>
            <span className="ml-auto font-mono text-xs text-gray-400 dark:text-gray-500">{contact.phone}</span>
          </label>
        ))}
        {contactsPage?.items.length === 0 && (
          <p className="px-3 py-3 text-center text-sm text-gray-400 dark:text-gray-500">Nenhum contato cadastrado.</p>
        )}
      </div>

      <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Modo de disparo</label>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode('auto')}
          className={`rounded-md border px-3 py-1.5 text-left text-sm ${
            mode === 'auto'
              ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
              : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
          }`}
        >
          Automático
          <span className="block text-xs font-normal opacity-80">Respeita os limites do anti-ban</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('direct')}
          className={`rounded-md border px-3 py-1.5 text-left text-sm ${
            mode === 'direct'
              ? 'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500'
              : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
          }`}
        >
          Direto (manual)
          <span className="block text-xs font-normal opacity-80">Ignora os limites do anti-ban</span>
        </button>
      </div>

      {mode === 'direct' && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20">
          <p className="mb-3 text-xs text-red-700 dark:text-red-400">
            No modo direto o disparo <strong>ignora</strong> os limites automáticos de aquecimento (por minuto/hora/dia)
            do anti-ban para a instância selecionada. Isso aumenta bastante o risco desse número ser bloqueado ou
            banido pelo WhatsApp. A decisão de usar esse modo é sua — fica registrada no histórico de mensagens
            (usuário e horário do disparo).
          </p>

          <label className="mb-1 block text-xs text-red-700 dark:text-red-400">
            Lotes (opcional, ex: 200,100,200 — soma deve ser igual ao nº de contatos selecionados)
          </label>
          <input
            value={batchSizesInput}
            onChange={(e) => setBatchSizesInput(e.target.value)}
            placeholder="deixe em branco para enviar tudo de uma vez"
            className="mb-1 w-full rounded-md border border-red-300 px-3 py-1.5 text-sm dark:border-red-900/60 dark:bg-gray-800 dark:text-gray-100"
          />
          {!batchSumMatches && (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">
              A soma dos lotes ({batchSum}) precisa ser igual ao nº de contatos selecionados ({selectedIds.size}).
            </p>
          )}

          {batchSizes.length > 1 && (
            <>
              <label className="mb-1 block text-xs text-red-700 dark:text-red-400">
                Intervalo entre lotes (minutos)
              </label>
              <input
                type="number"
                min={1}
                value={batchIntervalMinutes}
                onChange={(e) => setBatchIntervalMinutes(e.target.value)}
                className="mb-2 w-24 rounded-md border border-red-300 px-3 py-1.5 text-sm dark:border-red-900/60 dark:bg-gray-800 dark:text-gray-100"
              />
            </>
          )}

          <label className="mt-1 flex cursor-pointer items-start gap-2 text-xs text-red-800 dark:text-red-300">
            <input
              type="checkbox"
              checked={acknowledgeRisk}
              onChange={(e) => setAcknowledgeRisk(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Estou ciente de que este disparo pode causar o bloqueio/banimento do número no WhatsApp e assumo essa
              responsabilidade.
            </span>
          </label>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && <p className="mb-3 text-sm text-green-600 dark:text-green-400">{result}</p>}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
        >
          Fechar
        </button>
        <button
          onClick={() => dispatchMutation.mutate()}
          disabled={!canSubmit}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium text-white disabled:opacity-40 ${
            mode === 'direct' ? 'bg-red-600 dark:bg-red-500' : 'bg-gray-900 dark:bg-gray-100 dark:text-gray-900'
          }`}
        >
          {dispatchMutation.isPending ? 'Disparando...' : mode === 'direct' ? 'Disparar mesmo assim' : 'Disparar'}
        </button>
      </div>
    </Modal>
  );
}
