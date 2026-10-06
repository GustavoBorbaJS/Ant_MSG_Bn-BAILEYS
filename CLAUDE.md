# DISPARA — mapa do projeto para o Claude

CRM de disparo de mensagens de WhatsApp em massa com proteção anti-ban. Este arquivo é o ponto de partida de qualquer tarefa: diz onde cada coisa mora, quais regras não podem ser quebradas e como o código daqui é escrito. Leia a seção do serviço em que vai mexer antes de abrir arquivos.

## Os quatro serviços

O repositório é um monorepo sem workspace: cada pasta tem seu próprio `package.json` e `node_modules`, e sobe como um container separado (`docker-compose.yml`).

| Pasta | Container | Papel | Stack |
|---|---|---|---|
| `Ant_CRM_Web` | `crm-web` | Painel do operador | React 19, Vite, TanStack Query, Tailwind |
| `Ant_CRM_Bn` | `crm-api` (3002) | API do painel: usuários, contatos, campanhas, instâncias. **Produz** jobs na fila | NestJS, TypeORM, BullMQ (só `Queue`) |
| `Ant_MSG_Bn` | `msg-worker` | **Consome** a fila e decide quando cada mensagem sai (anti-ban) | NestJS, BullMQ (`Worker`), Redis |
| `Ant_Engine_Bn` | `engine` (3001) | Fala com o WhatsApp: Baileys (WhatsApp Web) ou Meta Cloud API | NestJS, Baileys |

Infra compartilhada: um Postgres (`crm-api` e `msg-worker`) e um Redis (fila `messages` do BullMQ + chaves `antiban:*`).

## Caminho de uma mensagem

```
Painel ──POST /campaigns/:id/dispatch──▶ crm-api
   CampaignsService.dispatch: grava message_logs 'pending' + enfileira 1 job por contato
        │  fila BullMQ 'messages' (Redis)
        ▼
msg-worker · MessageConsumer.process
   1. waitForInstance   instância conectada? senão reagenda
   2. waitForSendSlot   é a vez dela? (AntiBanService.acquireSendSlot, Lua no Redis)
   3. send              POST /send no engine
   4. handleSendFailure classifica o erro pelo status HTTP do engine
        │  HTTP + Bearer ENGINE_API_KEY
        ▼
engine · WhatsappController.send ──▶ MetaCloudService (ids em META_INSTANCES) ou WhatsappService (Baileys)
```

O worker atualiza a `message_log` para `sent` ou `failed`; o painel lê o progresso do banco.

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| Ritmo/espaçamento de envio, limites, pausa por rate limit | `Ant_MSG_Bn/src/anti-ban/anti-ban.service.ts` e `send-slot.lua.ts` |
| O que acontece com um job (reagendar, desistir, retentar) | `Ant_MSG_Bn/src/queue/queue.consumer.ts` |
| Defaults de limites e tempos do worker | `Ant_MSG_Bn/src/config/configuration.ts` |
| Conexão/pareamento Baileys, envio pelo WhatsApp Web | `Ant_Engine_Bn/src/whatsapp/whatsapp.service.ts` |
| Envio e erros da Meta Cloud API | `Ant_Engine_Bn/src/meta-cloud/meta-cloud.service.ts` |
| Contrato HTTP do engine (status por tipo de erro) | `Ant_Engine_Bn/src/whatsapp/whatsapp.controller.ts` |
| Disparo, lotes, agendamento, reenvio de falhas | `Ant_CRM_Bn/src/campaigns/campaigns.service.ts` |
| Checagem de saúde da instância (regras e pesos) | `Ant_CRM_Bn/src/instances/instance-health.rules.ts` |
| Diagnóstico por IA da saúde (prompt, modelo) | `Ant_CRM_Bn/src/instances/instance-health-advisor.service.ts` |
| Posse de instância por usuário | `Ant_CRM_Bn/src/instance-owners/instance-owners.service.ts` |
| Política de anti-ban editável no painel | `Ant_CRM_Bn/src/settings/settings.service.ts` |
| Schema do banco | `Ant_CRM_Bn/src/database/migrations/` (só o CRM migra) |
| Telas | `Ant_CRM_Web/src/pages/`, tipos da API em `src/lib/api.ts` |

## Regras que não podem ser quebradas

Cada uma existe por um incidente ou risco real; o motivo está junto para você julgar os casos de borda.

1. **Só o worker decide se um envio passa.** O CRM lê as chaves `antiban:*` (`AntibanReadonlyService`) e nunca dá `INCR`/`SET` nelas. A única chave que o CRM escreve é `antiban:config`, que é política, não estado. Dois escritores nos contadores quebrariam o limite sem ninguém perceber.
2. **Ler o aquecimento não pode iniciá-lo.** O worker usa `SET NX GET` em `antiban:{id}:firstSeen` porque o primeiro envio é o que liga o relógio; o CRM usa `GET` puro. Abrir uma tela não pode envelhecer um chip.
3. **Decisão de ritmo é atômica no Redis.** Checar e consumir cota acontecem no mesmo script Lua (`send-slot.lua.ts`). Ler o contador no Node e incrementar depois deixa jobs concorrentes furarem o limite.
4. **Reagendar não é falhar.** Instância caída, vez que ainda não chegou e rate limit do provedor usam `job.moveToDelayed` + `DelayedError` e não consomem `attempts`. `attempts` é só para falha real de envio. Erro permanente lança `UnrecoverableError`.
5. **O worker não dorme segurando slot.** Espera longa volta para a fila como `delayed`; `sleep` dentro do `process` só até `ANTIBAN_MAX_INLINE_WAIT_MS`. Um job dormindo trava as outras instâncias.
6. **Erro do engine se classifica pelo status HTTP, não pelo texto.** 400 destinatário inválido (não retenta), 409 instância indisponível, 429 rate limit do provedor (pausa a instância), 503 o resto. Erro novo no engine = classe em `whatsapp/errors.ts` + mapeamento no controller.
7. **`messageLogId` é a chave de idempotência do envio.** O engine reaproveita a chamada em andamento em vez de mandar duas vezes quando o worker retenta após timeout.
8. **Tudo no CRM é filtrado por dono.** Campanhas e contatos por `ownerId`; instâncias por `InstanceOwnersService.assertAccess`. Endpoint novo que recebe `instanceId` chama `assertAccess` antes de qualquer coisa.
9. **`instanceId` vira pasta em disco e chave do Redis.** Sempre validado por `^[a-zA-Z0-9_-]{1,64}$` antes de usar (path traversal).
10. **Contratos duplicados andam juntos.** Não há pacote compartilhado, então estes pares são cópias manuais; mudou um, mude o outro no mesmo commit:
    - `MessageJobData`: `Ant_CRM_Bn/src/queue/queue-producer.service.ts` ↔ `Ant_MSG_Bn/src/queue/queue.consumer.ts`
    - `defaultJobOptions` da fila: `queue-producer.service.ts` ↔ `Ant_MSG_Bn/src/queue/queue.module.ts`
    - entidade `message_logs`: uma em cada backend (o worker só toca status, datas e erro)
    - limites e dias de aquecimento: `configuration.ts` do worker ↔ do CRM
    - relatório de saúde: `Ant_Engine_Bn/src/common/instance-health.ts` ↔ `EngineHealthReport` em `instance-health.rules.ts` ↔ `InstanceHealth` em `Ant_CRM_Web/src/lib/api.ts`

## Como o espaçamento funciona

Por instância, o Redis guarda duas filas (ver o cabeçalho de `send-slot.lua.ts`):

- `nextSlot`: a partir de quando o próximo envio é permitido. Avança `minGap` a cada envio concedido, com `minGap = max(60s / perMinute do nível, ANTIBAN_MIN_DELAY_MS)`.
- `softCursor`: horário de retorno do último job adiado. Cada job adiado recebe o seu (`anterior + minGap + variação aleatória`), então ninguém acorda em manada no fim da janela.

Um envio é concedido quando não há pausa do provedor, nenhum contador (minuto, hora, dia, global) estourou e a vez está a no máximo `ANTIBAN_MAX_INLINE_WAIT_MS`. Um 429 do engine abre uma pausa (`antiban:{id}:cooldown`) que dobra a cada ocorrência seguida, de `ANTIBAN_COOLDOWN_BASE_MS` até `ANTIBAN_COOLDOWN_MAX_MS`.

O modo direto (`skipRateLimit`) pula tudo isso, menos a pausa do provedor.

Chaves: `antiban:{id}:firstSeen`, `:minute:{bucket}`, `:hour:{bucket}`, `:day:{bucket}`, `:nextSlot`, `:softCursor`, `:cooldown`, `:cooldownStrikes`, mais `antiban:global:day:{bucket}` e `antiban:config`. Se a fila for apagada à mão, apague também `antiban:{id}:softCursor`, senão os próximos jobs esperam por uma fila que não existe mais.

## Como o código daqui é escrito

- **Idioma:** comentários, logs e mensagens de erro para o usuário em português; identificadores em inglês.
- **Comentário explica o porquê**, quase sempre o incidente que motivou a linha, e aponta o arquivo do outro lado quando há contrato entre serviços. Não comente o que o código já diz. Ao mudar um comportamento, atualize o comentário que o explica e as referências a ele (`rg` pelo nome da função).
- **Função pública orquestra, privada executa.** `MessageConsumer.process` e `InstanceHealthService.check` são o modelo: uma sequência curta de passos nomeados, cada um um método privado com uma única responsabilidade. Se uma função precisa de comentários de seção para ser lida, quebre nela.
- **Retorno cedo** em vez de `else` aninhado; ternário encadeado vira `if` com retorno (ver `MetaCloudService.buildPayload`).
- **Sem número mágico:** tempo e limite viram constante nomeada no topo do arquivo ou entram em `configuration.ts` com a env correspondente (e então em `.env.example` da pasta, `.env.example` da raiz e `docker-compose.yml`).
- **Regra de negócio pura fica separada de I/O** quando dá: `instance-health.rules.ts` não toca rede nem banco, por isso dá para rodar e ajustar sozinha.
- **Não duplique bloco de disparo:** criar `message_log` e enfileirar passa por `CampaignsService.createAndEnqueue`.

### Padrões de projeto em uso

Use estes antes de inventar outro; o nome ajuda a achar o exemplo.

| Padrão | Onde | Quando repetir |
|---|---|---|
| **Strategy por provedor** | `WhatsappController` escolhe `MetaCloudService` ou `WhatsappService` por `hasInstance`; os dois expõem `sendMessage`, `getStatus`, `getHealth` | Capacidade nova do engine: implemente nos dois e roteie no controller |
| **Erros tipados → status HTTP** | `whatsapp/errors.ts` + `catch` do `send` | Toda causa de falha que o worker deva tratar diferente |
| **Tabela de regras** | `RULES` em `instance-health.rules.ts` | Avaliações com vários critérios independentes; nova checagem = novo item |
| **Leitura espelhada** | `AntibanReadonlyService` espelha o `AntiBanService` só com `GET` | O CRM precisa mostrar estado que pertence ao worker |
| **Mutex por chave** | `runExclusive` (promise chaining por `instanceId`) | Serializar em memória, por instância, sem travar as demais |
| **Idempotência com TTL** | `recentSends` nos dois serviços do engine | Chamada que pode ser repetida por timeout de quem chama |
| **Cache com TTL curto** | `statusCache` no `MetaCloudService` | Consulta a API externa feita a cada mensagem |
| **Degradação opcional** | `InstanceHealthAdvisorService`: sem chave ou com erro devolve `null` e a tela segue só com as regras | Dependência externa que enriquece, mas não pode derrubar o fluxo |

## Trabalhando com IA neste projeto

- A única chamada a LLM é o diagnóstico de saúde (`instance-health-advisor.service.ts`), via SDK oficial `@anthropic-ai/sdk`, modelo em `HEALTH_AI_MODEL` (padrão `claude-opus-5-5`).
- **Regras decidem, a IA explica.** Nota e veredito vêm de `instance-health.rules.ts`; o modelo recebe os sinais e a avaliação prontos e devolve resumo, riscos e recomendações em JSON com schema fixo. Não passe decisão de envio ou de bloqueio para o modelo.
- Ao editar o prompt: descreva a situação e o leitor (operador, não técnico), diga o que fazer em vez do que evitar, explique o motivo de cada restrição e mantenha o vocabulário do sistema (aquecimento, cooldown, modo direto) explicado no próprio prompt, porque o modelo não conhece este código.
- A saída é sempre lida por `JSON.parse` contra o schema; campo novo entra no schema, no tipo `HealthAiDiagnosis` e no painel.

## Comandos

Rodar dentro da pasta de cada serviço (não há script na raiz):

```bash
npm run build          # nest build (backends) | tsc -b && vite build (web)
npm run start:dev      # backends, com watch
npm run dev            # web (proxy /api -> :3002)
npm run lint           # só o web (oxlint)
npm run migration:run  # só Ant_CRM_Bn
```

Não há testes automatizados. Verifique com `npx tsc --noEmit -p tsconfig.json` no serviço alterado e, para o worker, com `scripts/mock-engine.js` + `scripts/enqueue-batch.js` contra um Redis local. Depois de mexer em `send-slot.lua.ts`, simule uma campanha inteira antes de confiar: o script roda dentro do Redis e erro ali não aparece no `tsc`.

Stack completa: `docker compose up --build` na raiz, com o `.env` da raiz (`.env.example`). Hash bcrypt no `.env` do Compose precisa de `$` dobrado (`$$`).

## Armadilhas conhecidas

- Arquivos em CRLF com `core.autocrlf=true`: diffs gigantes de fim de linha são ruído do editor, não mudança real.
- `MessageConsumer` aplica a concorrência em `onApplicationBootstrap`; em `onModuleInit` o `Worker` do BullMQ ainda não existe.
- O histórico de saúde do engine (`InstanceTelemetry`) fica em memória e zera a cada restart do container.
- Imagem/PDF de campanha é servida por URL interna do Docker (`CRM_INTERNAL_URL`); a Meta Cloud API precisaria de URL pública.
- `Ant_Engine_Bn/README.md` documenta bugs do Baileys 7.0.0-rc já investigados; leia antes de depurar reconexão.
