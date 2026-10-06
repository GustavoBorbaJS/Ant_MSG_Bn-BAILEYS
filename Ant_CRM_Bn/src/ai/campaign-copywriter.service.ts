import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from './ai.service';

// limite de texto de uma mensagem (ver SendDto em Ant_Engine_Bn/src/whatsapp/dto.ts)
const MAX_MESSAGE_LENGTH = 4096;

const SYSTEM_PROMPT = `Você é redator de mensagens de WhatsApp para campanhas de uma empresa brasileira. O texto que você escreve é enviado, tal como está, para uma lista de contatos por um sistema de disparo.

Você recebe um JSON com:
- "texto_atual": o rascunho do operador (pode vir vazio, quando ele quer que você escreva do zero).
- "pedido": o que o operador quer (tom, objetivo, o que mudar). Pode vir vazio; nesse caso, apenas melhore o rascunho.

O que faz uma boa mensagem aqui, e por quê:
- Quem recebe muitas vezes não tem o número salvo. Mensagem com cara de propaganda genérica é denunciada como spam, e denúncias derrubam o número. Por isso escreva como uma pessoa escreveria: direta, educada, sem exagero.
- Diga logo no começo quem fala e por que está escrevendo, e termine com um próximo passo claro e único.
- Seja curto: de 2 a 5 frases curtas costuma bastar. Mensagem longa não é lida.
- Use no máximo um ou dois emojis, e só se combinarem com o tom. Sem palavras inteiras em maiúsculas e sem sequências de pontuação.
- A formatação é a do WhatsApp: *negrito* com um asterisco de cada lado, _itálico_ com sublinhado. Não use Markdown (nada de **, # ou listas com hífen).

O que preservar:
- Todos os fatos do rascunho: nomes, preços, datas, prazos, endereços, links e telefones, exatamente como vieram. Não invente oferta, desconto, prazo ou dado que não esteja no rascunho ou no pedido.
- Marcadores entre chaves, como {nome}, ficam idênticos.
- O idioma do rascunho (português do Brasil, salvo se o pedido disser outra coisa).

Não inclua instrução de descadastro ("responda SAIR" e parecidos): o sistema já acrescenta esse rodapé sozinho.

Responda somente com o texto final da mensagem, pronto para enviar, sem aspas em volta, sem título e sem comentário antes ou depois.`;

// "Melhorar com IA" do formulário de campanha: reescreve o rascunho (ou
// escreve do zero a partir do pedido) com a IA configurada pelo usuário.
// Só devolve a sugestão - quem decide usar é o operador, na tela.
@Injectable()
export class CampaignCopywriterService {
  constructor(private readonly aiService: AiService) {}

  async improve(userId: string, currentText: string, request: string): Promise<{ text: string; model: string }> {
    if (!currentText.trim() && !request.trim()) {
      throw new BadRequestException('Escreva um rascunho ou diga o que a mensagem deve comunicar.');
    }

    const { text, model } = await this.aiService.complete(
      userId,
      SYSTEM_PROMPT,
      JSON.stringify({ texto_atual: currentText.trim(), pedido: request.trim() }),
    );
    return { text: text.slice(0, MAX_MESSAGE_LENGTH), model };
  }
}
