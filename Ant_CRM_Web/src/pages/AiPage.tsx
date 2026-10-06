import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AiModelOption, AiProviderId, AiSettings } from '../lib/api';
import { SparklesIcon } from '../components/icons';

function errorMessage(err: any, fallback: string): string {
  const message = err?.response?.data?.message;
  return Array.isArray(message) ? message.join(' ') : message || fallback;
}

// Configuração de IA do PRÓPRIO usuário: provedor, chave de API e modelo.
// A chave nunca volta do servidor - depois de salva só aparece o final dela
// (keyHint), e o campo fica vazio pra digitar uma nova quando quiser trocar.
export function AiPage() {
  const { data: settings } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: async () => (await api.get<AiSettings>('/ai/settings')).data,
  });

  if (!settings) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>;
  }
  return <AiSettingsForm settings={settings} />;
}

function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const queryClient = useQueryClient();
  // o formulário abre com o que o usuário já salvou (a chave do servidor não é
  // dele pra editar, então nesse caso abre em branco)
  const saved = settings.source === 'user' ? settings : null;
  const [provider, setProvider] = useState<AiProviderId>(saved?.provider ?? 'anthropic');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(saved?.model ?? '');
  const [models, setModels] = useState<AiModelOption[]>([]);
  // digitar o nome do modelo à mão, pra quando ele não aparece na lista
  const [customModel, setCustomModel] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const providerInfo = settings.providers.find((p) => p.id === provider);
  const hasSavedKey = settings.source === 'user' && settings.provider === provider;
  const canUseKey = apiKey.trim().length > 0 || hasSavedKey;

  const modelsMutation = useMutation({
    mutationFn: async () =>
      (await api.post<AiModelOption[]>('/ai/models', { provider, apiKey: apiKey.trim() || undefined })).data,
    onSuccess: (list) => {
      setModels(list);
      if (!list.some((m) => m.id === model)) {
        setModel(list.find((m) => m.id === providerInfo?.defaultModel)?.id ?? list[0]?.id ?? '');
      }
      setCustomModel(false);
      setFeedback({
        kind: 'ok',
        text: `${list.length} modelo(s) disponível(is). Escolha um, salve e use "Testar conexão" para confirmar.`,
      });
    },
    onError: (err) => {
      setModels([]);
      setFeedback({ kind: 'error', text: errorMessage(err, 'Não foi possível buscar os modelos.') });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      (await api.put<AiSettings>('/ai/settings', { provider, model: model || undefined, apiKey: apiKey.trim() || undefined }))
        .data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['ai-settings'], saved);
      setApiKey('');
      setShowKey(false);
      setFeedback({ kind: 'ok', text: 'Configuração salva.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: errorMessage(err, 'Não foi possível salvar.') }),
  });

  const testMutation = useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean; model: string }>('/ai/test')).data,
    onSuccess: (res) => setFeedback({ kind: 'ok', text: `Funcionando: o modelo ${res.model} respondeu.` }),
    onError: (err) => setFeedback({ kind: 'error', text: errorMessage(err, 'O teste falhou.') }),
  });

  const removeMutation = useMutation({
    mutationFn: async () => (await api.delete<AiSettings>('/ai/settings')).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['ai-settings'], saved);
      setApiKey('');
      setModel('');
      setModels([]);
      setFeedback({ kind: 'ok', text: 'Chave removida.' });
    },
    onError: (err) => setFeedback({ kind: 'error', text: errorMessage(err, 'Não foi possível remover.') }),
  });

  function chooseProvider(id: AiProviderId) {
    setProvider(id);
    setApiKey('');
    setModels([]);
    setCustomModel(false);
    setModel(settings.source === 'user' && settings.provider === id ? (settings.model ?? '') : '');
    setFeedback(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    saveMutation.mutate();
  }

  const busy = modelsMutation.isPending || saveMutation.isPending || testMutation.isPending || removeMutation.isPending;
  // o modelo salvo aparece na lista mesmo antes de buscar os modelos da chave
  const modelOptions = models.length > 0 ? models : model ? [{ id: model, label: model }] : [];

  return (
    <div className="max-w-2xl">
      <div className="mb-1 flex items-center gap-2">
        <SparklesIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">IA</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        Conecte a IA da sua preferência com a sua própria chave. Ela é usada no diagnóstico de saúde das instâncias e
        no botão "Melhorar com IA" das campanhas. O consumo é cobrado na sua conta do provedor.
      </p>

      <StatusCard settings={settings} />

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Provedor
        </span>
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {settings.providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => chooseProvider(p.id)}
              aria-pressed={provider === p.id}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${
                provider === p.id
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label
          htmlFor="ai-api-key"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          Chave de API
        </label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-800">
          <input
            id="ai-api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={hasSavedKey ? `Chave salva (final ${settings.keyHint}) — digite para trocar` : providerInfo?.keyPlaceholder}
            className="min-w-0 flex-1 bg-transparent px-3.5 py-3 font-mono text-sm text-gray-900 outline-none placeholder:font-sans placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="border-l border-gray-200 px-3.5 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-100"
          >
            {showKey ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p className="mb-5 mt-1.5 text-xs text-gray-400 dark:text-gray-500">
          Guardada cifrada e nunca exibida de novo.{' '}
          {providerInfo && (
            <a
              href={providerInfo.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-400"
            >
              Onde criar a chave
            </a>
          )}
        </p>

        <label
          htmlFor="ai-model"
          className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
        >
          Modelo
        </label>
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          {customModel ? (
            <input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              placeholder="nome exato do modelo, ex: glm-5.3"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          ) : (
            <select
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={modelOptions.length === 0}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-800/50"
            >
              {modelOptions.length === 0 && <option value="">Busque os modelos da sua chave</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label === m.id ? m.id : `${m.label} (${m.id})`}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => modelsMutation.mutate()}
            disabled={!canUseKey || busy}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {modelsMutation.isPending ? 'Buscando...' : 'Buscar modelos'}
          </button>
        </div>
        <p className="-mt-3 mb-5 text-xs text-gray-400 dark:text-gray-500">
          <button
            type="button"
            onClick={() => setCustomModel((v) => !v)}
            className="text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-400"
          >
            {customModel ? 'Escolher da lista' : 'Meu modelo não está na lista'}
          </button>
        </p>

        {feedback && (
          <p
            role="status"
            className={`mb-4 rounded-lg px-3 py-2 text-sm ${
              feedback.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {feedback.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!canUseKey || (!model && !providerInfo?.defaultModel) || busy}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              testMutation.mutate();
            }}
            disabled={!settings.configured || busy}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {testMutation.isPending ? 'Testando...' : 'Testar conexão'}
          </button>
          {settings.source === 'user' && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Remover a sua chave de API? A IA deixa de funcionar até você cadastrar outra.')) {
                  removeMutation.mutate();
                }
              }}
              disabled={busy}
              className="ml-auto text-sm text-red-600 hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
            >
              Remover chave
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function StatusCard({ settings }: { settings: AiSettings }) {
  const providerLabel = settings.providers.find((p) => p.id === settings.provider)?.label;

  const status = !settings.configured
    ? { dot: 'bg-gray-400', title: 'Nenhuma IA conectada', detail: 'Cadastre uma chave abaixo para ativar os recursos de IA.' }
    : settings.source === 'user'
      ? { dot: 'bg-emerald-500', title: `Conectado: ${providerLabel}`, detail: `Modelo ${settings.model} · chave final ${settings.keyHint}` }
      : {
          dot: 'bg-amber-500',
          title: 'Usando a IA padrão do servidor',
          detail: `Modelo ${settings.model}. Cadastre a sua chave abaixo para usar a IA da sua preferência.`,
        };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{status.title}</div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{status.detail}</div>
      </div>
    </div>
  );
}
