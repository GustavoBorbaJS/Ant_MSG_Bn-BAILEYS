import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Contact, ImportContactsResult, Paginated } from '../lib/api';
import { Modal } from '../components/Modal';

export function ContactsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [importResult, setImportResult] = useState<ImportContactsResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search],
    queryFn: async () => (await api.get<Paginated<Contact>>('/contacts', { params: { search } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  const importMutation = useMutation({
    mutationFn: (phones: string[]) => api.post<ImportContactsResult>('/contacts/import', { phones }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setImportResult(res.data);
    },
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível importar o arquivo.'),
  });

  function handleDelete(contact: Contact) {
    if (confirm(`Remover o contato "${contact.name}"?`)) {
      deleteMutation.mutate(contact.id);
    }
  }

  function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const phones = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (phones.length === 0) {
        alert('O arquivo está vazio.');
        return;
      }
      importMutation.mutate(phones);
    };
    reader.onerror = () => alert('Não foi possível ler o arquivo.');
    reader.readAsText(file);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Contatos</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
          >
            {importMutation.isPending ? 'Importando...' : 'Importar .txt'}
          </button>
          <button
            onClick={() => setEditing('new')}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
          >
            Novo contato
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
          <span>
            Importação: {importResult.imported} novo{importResult.imported === 1 ? '' : 's'},{' '}
            {importResult.duplicates} já cadastrado{importResult.duplicates === 1 ? '' : 's'},{' '}
            {importResult.invalid} inválido{importResult.invalid === 1 ? '' : 's'} (de {importResult.received} linha
            {importResult.received === 1 ? '' : 's'}).
          </span>
          <button
            onClick={() => setImportResult(null)}
            className="ml-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">Tags</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((contact) => (
              <tr key={contact.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{contact.name}</td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{contact.phone}</td>
                <td className="px-4 py-2">
                  {contact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="mr-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setEditing(contact)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(contact)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhum contato ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <ContactFormModal contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ContactFormModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [tags, setTags] = useState(contact?.tags.join(', ') ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        phone,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: notes || undefined,
      };
      return contact ? api.patch(`/contacts/${contact.id}`, body) : api.post('/contacts', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      onClose();
    },
    onError: () => setError('Não foi possível salvar. Confira os dados.'),
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
          {contact ? 'Editar contato' : 'Novo contato'}
        </h2>

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Telefone (com DDI)</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          placeholder="5511999999999"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Tags (separadas por vírgula)</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="vip, cliente"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
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
