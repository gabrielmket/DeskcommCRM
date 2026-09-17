import type { SupabaseClient } from "@supabase/supabase-js";

import { estornar } from "@/lib/broadcast/motor";
import { desfechoDaMeta, proximoDesfecho, type StatusDoDestinatario } from "@/lib/broadcast/desfecho";
import { logger } from "@/lib/logger";

/**
 * O webhook da Meta chegando na CAMPANHA.
 *
 * Sem isto, `broadcast_recipients` parava em `enviada` para sempre: a tela
 * mostrava a campanha inteira como enviada e nunca como entregue, o `estornar`
 * ficava sem quem o chamasse, e o índice por `external_id` que existe
 * justamente para esta consulta nunca era usado.
 *
 * ── O estorno acontece AQUI, e não no motor ─────────────────────────────────
 *
 * O motor cobra quando a Meta ACEITA — é o que ela fatura. A recusa definitiva
 * vem depois, por webhook, e às vezes minutos depois. Quem devolve o dinheiro é
 * quem recebe essa notícia; deixar o motor esperando por ela o transformaria
 * num processo que segura a fila para saber o desfecho de uma mensagem que já
 * saiu.
 */
export async function aplicarDesfechoNaCampanha(
  admin: SupabaseClient,
  input: { organizationId: string; externalId: string; statusDaMeta: string },
): Promise<"nao_e_disparo" | "sem_mudanca" | "atualizado" | "estornado"> {
  const chegou = desfechoDaMeta(input.statusDaMeta);
  if (!chegou) return "nao_e_disparo";

  const { data: linha } = await admin
    .from("broadcast_recipients")
    .select("id, status, preco_cents")
    .eq("organization_id", input.organizationId)
    .eq("external_id", input.externalId)
    .maybeSingle();
  // Mensagem que não é de campanha (conversa normal do inbox) passa reto — este
  // caminho é um a mais, não o único.
  if (!linha) return "nao_e_disparo";

  const atual = linha.status as StatusDoDestinatario;
  const novo = proximoDesfecho(atual, chegou);
  if (!novo) return "sem_mudanca";

  const agora = new Date().toISOString();
  await admin
    .from("broadcast_recipients")
    .update({ status: novo, atualizado_em: agora })
    .eq("id", linha.id);

  if (novo !== "falhou") return "atualizado";

  /**
   * Falhou DEPOIS de cobrada → devolve.
   *
   * A cobrança acontece no aceite; a recusa definitiva vem por webhook. Sem o
   * estorno, o cliente pagaria por mensagem que a Meta admitiu não ter
   * entregue — e é o tipo de erro que ele descobre conferindo o extrato, que é
   * o pior lugar para se descobrir qualquer coisa.
   */
  const preco = Number(linha.preco_cents ?? 0);
  if (preco <= 0) return "atualizado";

  const devolvido = await estornar(admin, {
    organizationId: input.organizationId,
    recipientId: linha.id as string,
    precoCents: preco,
  });
  if (!devolvido) {
    logger.error("[broadcast] falhou e NÃO estornou", {
      recipient_id: linha.id,
      preco_cents: preco,
    });
    return "atualizado";
  }

  // `estornada` é o estado FINAL: diz que falhou E que o dinheiro voltou. Parar
  // em `falhou` deixaria indistinguível "falhou e devolvemos" de "falhou e o
  // cliente pagou" — que é a pergunta que ele faz ao ver o extrato.
  await admin
    .from("broadcast_recipients")
    .update({ status: "estornada", atualizado_em: agora })
    .eq("id", linha.id);

  return "estornado";
}
