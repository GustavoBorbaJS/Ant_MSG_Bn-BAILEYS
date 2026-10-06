// Decide, de forma ATOMICA, se a instância pode enviar agora - e, se não
// puder, quando o job deve voltar. Roda inteiro dentro do Redis (EVAL), então
// vale pra qualquer concorrência/quantidade de réplicas do worker.
//
// Duas "filas" por instância:
//   nextSlot   - fila de verdade: instante a partir do qual o PRÓXIMO envio é
//                permitido. Só avança quando um envio é concedido.
//   softCursor - fila de espera: último horário de retorno já entregue a um
//                job adiado. Cada job adiado recebe um horário próprio (o
//                anterior + softGap), em vez de todos acordarem juntos no fim
//                da janela e disputarem a mesma vaga.
//
// softGap >= minGap sempre (ver AntiBanService), então quem acorda na fila de
// espera normalmente já encontra a fila de verdade livre.
//
// KEYS: 1 nextSlot, 2 softCursor, 3 cooldown, 4 minuto, 5 hora, 6 dia, 7 dia global
// ARGV: 1 agora(ms), 2 minGap(ms), 3 softGap(ms), 4 maxInlineWait(ms),
//       5-8 limites (minuto, hora, dia, global),
//       9-11 fim da janela atual em ms (minuto, hora, dia)
// Retorno: { 1, sendAt, '' } concedido | { 0, retryAt, motivo } adiado
//   motivo: 'cooldown' | 'minute' | 'hour' | 'day' | 'global' | 'pacing'
export const ACQUIRE_SEND_SLOT_SCRIPT = `
local now = tonumber(ARGV[1])
local minGap = tonumber(ARGV[2])
local softGap = tonumber(ARGV[3])
local maxInlineWait = tonumber(ARGV[4])

local windows = {
  { key = KEYS[4], limit = tonumber(ARGV[5]), endsAt = tonumber(ARGV[9]),  ttl = 60000,    name = 'minute' },
  { key = KEYS[5], limit = tonumber(ARGV[6]), endsAt = tonumber(ARGV[10]), ttl = 3600000,  name = 'hour' },
  { key = KEYS[6], limit = tonumber(ARGV[7]), endsAt = tonumber(ARGV[11]), ttl = 86400000, name = 'day' },
  { key = KEYS[7], limit = tonumber(ARGV[8]), endsAt = tonumber(ARGV[11]), ttl = 86400000, name = 'global' },
}

local blockedUntil = 0
local reason = ''

local cooldownUntil = tonumber(redis.call('GET', KEYS[3]) or '0')
if cooldownUntil > now then
  blockedUntil = cooldownUntil
  reason = 'cooldown'
end

for _, window in ipairs(windows) do
  local used = tonumber(redis.call('GET', window.key) or '0')
  if used >= window.limit and window.endsAt > blockedUntil then
    blockedUntil = window.endsAt
    reason = window.name
  end
end

if blockedUntil == 0 then
  local sendAt = now
  local nextSlot = tonumber(redis.call('GET', KEYS[1]) or '0')
  if nextSlot > sendAt then
    sendAt = nextSlot
  end

  if sendAt - now <= maxInlineWait then
    for _, window in ipairs(windows) do
      if redis.call('INCR', window.key) == 1 then
        redis.call('PEXPIRE', window.key, window.ttl)
      end
    end
    redis.call('SET', KEYS[1], sendAt + minGap, 'PX', (sendAt - now) + minGap + 60000)
    return { 1, sendAt, '' }
  end

  blockedUntil = sendAt
  reason = 'pacing'
end

local retryAt = blockedUntil
local softCursor = tonumber(redis.call('GET', KEYS[2]) or '0')
if softCursor + softGap > retryAt then
  retryAt = softCursor + softGap
end
redis.call('SET', KEYS[2], retryAt, 'PX', (retryAt - now) + 3600000)
return { 0, retryAt, reason }
`;

// Abre (ou estende) a pausa da instância depois de um rate limit do provedor.
// A duração dobra a cada ocorrência dentro da janela de "strikes" e nunca
// encurta uma pausa que já esteja valendo.
//
// KEYS: 1 cooldown, 2 strikes
// ARGV: 1 agora(ms), 2 base(ms), 3 teto(ms), 4 retryAfter pedido pelo provedor(ms, 0 = não informado),
//       5 validade do contador de strikes(ms)
// Retorno: { até quando(ms), nº de strikes }
export const START_COOLDOWN_SCRIPT = `
local now = tonumber(ARGV[1])
local base = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local providerRetryAfter = tonumber(ARGV[4])

local strikes = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]))

local duration = math.floor(base * (2 ^ (strikes - 1)))
if duration > max then duration = max end
if providerRetryAfter > duration then duration = providerRetryAfter end

local untilMs = now + duration
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > untilMs then untilMs = current end

redis.call('SET', KEYS[1], untilMs, 'PX', untilMs - now)
return { untilMs, strikes }
`;
