/**
 * O e-mail que a pessoa informa na conversa vai DIRETO para o cadastro.
 *
 * Decisão desta instalação (Time Company, 2026-09-15), e diferente do desenho
 * do produto para os outros campos: nome e telefone continuam como PROPOSTA que
 * uma pessoa confirma (`crm_propose_contact_field`), porque trocar nome ou
 * número por um palpite da IA quebra a identidade do contato. O e-mail não:
 * ele é pedido pelo próprio agente para mandar o convite da reunião, e com ele
 * parado numa proposta o convite do Google nunca chegava — o agente marcava a
 * reunião, dizia que o convite ia por e-mail, e o evento nascia sem convidado.
 *
 * O que a gravação direta PRECISA carregar para não furar as regras que a
 * confirmação humana já cumpria (rota `contacts/[id]/proposals/[proposal_id]`):
 *
 * - a BASE LEGAL no mesmo ato (`consent.transactional`, spec 17 §4b / L-05): o
 *   `lib/lgpd/export-collector.ts` lê esse registro, e e-mail gravado sem ele
 *   seria dado pessoal sem base registrada;
 * - o vencimento de proposta de e-mail que ainda estava PENDENTE: aceitá-la
 *   depois trocaria o e-mail novo pelo antigo em silêncio.
 *
 * `soSeVazio` existe para o convite de reunião: o e-mail do convite pode ser de
 * outra pessoa (a secretária, o sócio) e não deve sobrescrever o do cliente.
 *
 * Nunca derruba o turno: falha de gravação volta como `gravado: false` com o
 * motivo, e quem chamou decide o que fazer.
 */
import { z } from "zod";

import { patchContactHandler } from "@/app/api/v1/contacts/_handler";
import { ApiError } from "@/lib/api/types";
import type { McpContext } from "@/lib/mcp/types";

export const emailInformadoSchema = z.string().trim().email().max(254);

export type GravacaoDeEmail = { gravado: true } | { gravado: false; motivo: string };

export async function gravarEmailDoContato(
  ctx: McpContext,
  contactId: string,
  email: string,
  opcoes: { soSeVazio?: boolean } = {},
): Promise<GravacaoDeEmail> {
  const valido = emailInformadoSchema.safeParse(email);
  if (!valido.success) return { gravado: false, motivo: "email_invalido" };
  try {
    if (opcoes.soSeVazio) {
      const { data, error } = await ctx.supabase
        .from("contacts")
        .select("email")
        .eq("organization_id", ctx.organizationId)
        .eq("id", contactId)
        .maybeSingle();
      if (error) return { gravado: false, motivo: "erro" };
      const atual = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
      if (atual && atual !== valido.data.toLowerCase()) {
        return { gravado: false, motivo: "contato_ja_tem_outro_email" };
      }
    }

    const agora = new Date().toISOString();
    await patchContactHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      contactId,
      {
        email: valido.data,
        consent: {
          transactional: {
            granted: true,
            granted_at: agora,
            source: "informado pelo titular em atendimento; gravado pelo agente de IA",
          },
        },
      },
    );

    // Falhar aqui não desfaz a gravação (já feita): no pior caso a proposta
    // antiga continua visível e uma pessoa a descarta.
    await ctx.supabase
      .from("contact_field_proposals")
      .update({ status: "expired", decided_at: agora })
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", contactId)
      .eq("campo", "email")
      .eq("status", "pending");

    return { gravado: true };
  } catch (e) {
    return { gravado: false, motivo: e instanceof ApiError ? e.code : "erro" };
  }
}
