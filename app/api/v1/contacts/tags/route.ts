/**
 * GET /api/v1/contacts/tags — as tags que os contatos REALMENTE têm.
 *
 * Existe por causa de um silêncio medido na primeira campanha real: o filtro do
 * disparador era texto livre, e um nome que não existe devolve lista vazia sem
 * dizer por quê. Foi assim que se descobriu que `contacts.tags` e
 * `crm_leads.tags` são colunas diferentes — a tag tinha sido posta no CARTÃO do
 * funil, o filtro lê a do CONTATO, e o sistema respondeu zero calado.
 *
 * A CONTAGEM vem junto e não é enfeite: é ela que responde antes de custar. Ver
 * `vip (0)` no seletor encerra a dúvida na hora; sem o número, a mesma
 * descoberta exige montar a lista e encarar um "0 destinatários" sem causa.
 *
 * O `unnest` + `group by` mora no banco (`fn_contact_tags`, migration 0249)
 * porque o PostgREST não o expressa: fazer aqui exigiria puxar a coluna de
 * TODOS os contatos e agregar no Node — uma transferência de 50 mil arrays a
 * cada vez que alguém abre o seletor.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  // `viewer`: é leitura de vocabulário, o mesmo piso de quem abre a lista de
  // contatos. Exigir mais aqui esconderia o seletor de quem monta a campanha.
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  const { data, error } = await db.rpc("fn_contact_tags", { p_org: authz.org.orgId });

  if (error) {
    /**
     * Erro vira 500, e NÃO lista vazia.
     *
     * Devolver `[]` numa falha de leitura seria dizer "esta organização não tem
     * tag nenhuma" — a mesma mentira tranquila que este endpoint existe para
     * matar, só que uma camada acima.
     */
    return fail("query_failed", error.message, 500, { requestId });
  }

  return ok(
    {
      tags: (data ?? []).map((l: { tag: string; quantos: number }) => ({
        tag: l.tag,
        quantos: Number(l.quantos),
      })),
    },
    { requestId },
  );
}
