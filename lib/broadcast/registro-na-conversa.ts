import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/**
 * O DISPARO VIRA MENSAGEM NA CONVERSA — a metade que faltava.
 *
 * O motor gravava em duas tabelas: a carteira e `broadcast_recipients`. A
 * mensagem saía pela Cloud API, era cobrada e registrada como "enviada" — e
 * **não existia no inbox**. Três coisas quebravam por causa disso, e a terceira
 * é a que estraga o produto:
 *
 *  1. O operador não via o que foi mandado para quem.
 *  2. A resposta do cliente chegava sem nada antes dela, como alguém puxando
 *     assunto do nada.
 *  3. O AGENTE respondia às cegas. O lead diz "quero sim" e a IA lê um histórico
 *     que começa naquele "quero sim" — porque a mensagem que o provocou nunca
 *     entrou. É o primeiro invariante da doutrina deste repo ("nada é ilha")
 *     quebrado no lugar mais caro.
 *
 * ── Por que grava o TEXTO e não "template X enviado" ────────────────────────
 *
 * Porque quem lê o histórico depois — pessoa ou modelo — precisa do que o
 * cliente VIU. "Template retomada_captacao_v1 enviado" não explica a resposta
 * "pode ser terça"; o texto com as variáveis aplicadas explica.
 *
 * ── Por que falhar aqui não derruba o envio ─────────────────────────────────
 *
 * Quando esta função roda, a Meta já aceitou e a carteira já foi debitada.
 * Transformar uma falha de escrita local em erro do disparo faria o motor
 * marcar como `falhou` algo que o cliente recebeu — e aí a campanha reenviaria,
 * cobrando de novo. Registrar é importante; desfazer um envio bem-sucedido é
 * pior. Por isso: devolve `false`, deixa a linha no log e segue.
 */
export async function registrarNaConversa(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    /** `null` quando o destinatário entrou só como telefone, sem cadastro. */
    contactId: string | null;
    channelSessionId: string;
    /** O texto COM as variáveis aplicadas — o que a pessoa leu. */
    texto: string;
    externalId: string | null;
    templateName: string;
    broadcastId: string;
  },
): Promise<boolean> {
  // Sem contato não há conversa a que anexar. Não é erro: é o destinatário que
  // veio como telefone solto, e forçar um cadastro aqui criaria contato fantasma
  // a cada disparo.
  if (!input.contactId) return false;

  const { data: conversationId, error: erroConversa } = await admin.rpc(
    "fn_upsert_wa_conversation" as never,
    {
      p_org: input.organizationId,
      p_contact: input.contactId,
      p_session: input.channelSessionId,
    } as never,
  );
  if (erroConversa || !conversationId) {
    logger.error("[broadcast] disparo enviado mas SEM conversa", {
      broadcast_id: input.broadcastId,
      contact_id: input.contactId,
      erro: erroConversa?.message,
    });
    return false;
  }

  const agora = new Date().toISOString();
  const { error } = await admin.from("messages").insert({
    organization_id: input.organizationId,
    conversation_id: conversationId as string,
    // NOT NULL na tabela — e é ele que diz por qual número a mensagem saiu.
    channel_session_id: input.channelSessionId,
    contact_id: input.contactId,
    direction: "outbound",
    // `sent`, e não `delivered`: a Meta ACEITOU. A entrega é notícia posterior,
    // e quem a traz é o webhook de status — o mesmo que move a campanha.
    status: "sent",
    type: "template",
    body: input.texto,
    template_name: input.templateName,
    // `automation`: não foi pessoa digitando nem o agente respondendo. Isso é o
    // que permite separar, no relatório, o que a régua mandou do que alguém falou.
    sent_via: "automation",
    external_id: input.externalId,
    sent_at: agora,
    metadata: { broadcast_id: input.broadcastId },
  });

  if (error) {
    logger.error("[broadcast] disparo enviado mas NÃO virou mensagem", {
      broadcast_id: input.broadcastId,
      contact_id: input.contactId,
      erro: error.message,
    });
    return false;
  }

  return true;
}
