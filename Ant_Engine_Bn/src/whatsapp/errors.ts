// Erros tipados pro /send diferenciar causa permanente (não adianta retentar,
// ex: número inválido) de transitória (retentar mais tarde tem chance de dar
// certo, ex: instância caiu no meio do envio) - sem isso, o worker
// (Ant_MSG_Bn/src/queue/queue.consumer.ts) só tinha o 503 genérico e a
// mensagem de erro em texto livre pra tentar adivinhar.

export class InstanceNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceNotConnectedError';
  }
}

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}
