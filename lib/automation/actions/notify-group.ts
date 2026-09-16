/**
 * Ação `notify_group` — o aviso que vai para o TIME, não para o lead.
 *
 * Toda ação de mensagem que existia aqui fala com o contato do evento: elas
 * atravessam consentimento, janela de 24h, limite diário e espaçamento, porque
 * do outro lado há um cliente que pode marcar como spam. Este aviso é outra
 * coisa — é o recado interno de "marcaram reunião com fulano", no grupo em que
 * o time comercial já trabalha. Tratá-lo com a régua do contato o faria ser
 * adiado para a manhã seguinte por causa de uma janela que não é dele; tratá-lo
 * como mensagem de cliente o faria contar contra o limite diário do número.
 *
 * O que ele NÃO faz, de propósito:
 *  - não abre conversa nem grava mensagem no inbox. O grupo do time não é
 *    atendimento; virar thread no inbox encheria a fila de quem atende cliente.
 *  - não resolve destinatário a partir de contato. O destino é digitado pelo
 *    operador (o id do grupo), e é dele a decisão de para onde o aviso vai.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { renderTemplate } from "@/lib/automation/template";
import { getAdapter } from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";

const TIPO = "notify_group";

/**
 * Um id de grupo do WhatsApp termina em `@g.us`; um número, em `@c.us`.
 *
 * A checagem existe porque o erro fácil aqui é colar o telefone de alguém no
 * lugar do grupo — e aí o aviso interno, com resumo de qualificação e valor,
 * sai para um CLIENTE. Recusar é melhor que mandar: um aviso que não chega o
 * operador percebe no mesmo dia; um que chega no lugar errado, ninguém.
 */
function pareceGrupo(chatId: string): boolean {
  return /@g\.us$/i.test(chatId.trim());
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const chatId = typeof config.chat_id === "string" ? config.chat_id.trim() : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!sessionId || !chatId || !template) {
    return { type: TIPO, status: "failed", error: "missing_config" };
  }
  if (!pareceGrupo(chatId)) {
    return { type: TIPO, status: "failed", error: "destino_nao_e_grupo" };
  }

  // O filtro por organização é explícito: o client é admin e a RLS não vale.
  const { data: sessao, error } = await ctx.admin
    .from("channel_sessions")
    .select(CHANNEL_SESSION_REF_COLUMNS)
    .eq("id", sessionId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) return { type: TIPO, status: "failed", error: error.message };
  if (!sessao) return { type: TIPO, status: "failed", error: "canal_nao_encontrado" };

  const ref = sessao as unknown as ChannelSessionRef;
  // Grupo é conceito de WhatsApp não-oficial. A API oficial da Meta não envia
  // para grupo, e deixar o adapter falhar lá embaixo devolveria um erro de HTTP
  // no lugar da frase que explica por que este canal não serve.
  if (ref.provider !== "waha") {
    return { type: TIPO, status: "failed", error: "canal_sem_grupo" };
  }

  try {
    const { externalId } = await getAdapter(ref.provider).send({
      organizationId: ctx.organizationId,
      sessionRef: resolveSessionRef(ref),
      to: chatId,
      kind: "text",
      body: renderTemplate(template, ctx.context),
    });
    return { type: TIPO, status: "success", detail: { chat_id: chatId, external_id: externalId } };
  } catch (err) {
    return {
      type: TIPO,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerAction({ type: TIPO, execute });
