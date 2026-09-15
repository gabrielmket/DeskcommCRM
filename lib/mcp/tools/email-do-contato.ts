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
 * Nunca derruba o turno: falha de gravação (e-mail já usado por outro contato
 * da organização, contato anonimizado) volta como `gravado: false` com o motivo,
 * e quem chamou decide o que fazer.
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
): Promise<GravacaoDeEmail> {
  const valido = emailInformadoSchema.safeParse(email);
  if (!valido.success) return { gravado: false, motivo: "email_invalido" };
  try {
    await patchContactHandler(
      ctx.supabase,
      { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId },
      contactId,
      { email: valido.data },
    );
    return { gravado: true };
  } catch (e) {
    return { gravado: false, motivo: e instanceof ApiError ? e.code : "erro" };
  }
}
