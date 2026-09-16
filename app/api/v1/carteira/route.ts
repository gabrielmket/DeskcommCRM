/**
 * A CARTEIRA DO CLIENTE — o que ele comprou, o que gastou, e quanto sobrou.
 *
 * Esta é a tela do TENANT, e a distinção com `/api/v1/admin/carteira` é a mesma
 * que separa cobrança de custo em todo o resto do sistema: aqui aparece o preço
 * que ELE paga e o extrato DELE; o que a operação paga ao provedor não passa
 * por aqui e não tem policy que o exponha (ver `lib/ai/custo-e-da-plataforma.ts`).
 *
 * Só leitura. Crédito entra por decisão comercial (painel administrativo) e
 * débito entra pelo motor de envio — nenhum dos dois é coisa que o cliente
 * escreva, e o `grant` da migration 0244 já recusa a escrita no banco.
 *
 * Auth: manager+. O extrato mostra quanto a empresa gastou, que não é
 * informação de atendente.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  creditoAcabando,
  derivarSaldo,
  podeDisparar,
  type LancamentoDaCarteira,
} from "@/lib/carteira/saldo";

export const dynamic = "force-dynamic";

/**
 * O extrato mostrado. O saldo NÃO sai daqui: uma página de 200 linhas somaria
 * só as 200 e mostraria um saldo errado para quem já teve mais lançamentos —
 * por isso a soma é feita sobre o extrato inteiro, e esta lista é só o que a
 * tela exibe.
 */
const LINHAS_NA_TELA = 200;

export async function GET(_req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const db = await createClient();

  const [extratoRes, todosRes, precoRes] = await Promise.all([
    db
      .from("tenant_wallet_ledger")
      .select("id, tipo, amount_cents, currency, occurred_at, ref_kind, ref_id, note")
      .eq("organization_id", org.orgId)
      .order("occurred_at", { ascending: false })
      .limit(LINHAS_NA_TELA),
    // A soma vai sobre TODAS as linhas, não sobre a página acima.
    db
      .from("tenant_wallet_ledger")
      .select("tipo, amount_cents, occurred_at")
      .eq("organization_id", org.orgId)
      .limit(100_000),
    db
      .from("tenant_broadcast_pricing")
      .select("preco_por_mensagem_cents, alerta_saldo_cents")
      .eq("organization_id", org.orgId)
      .maybeSingle(),
  ]);

  if (extratoRes.error) return fail("query_failed", extratoRes.error.message, 500, { requestId });
  if (todosRes.error) return fail("query_failed", todosRes.error.message, 500, { requestId });

  const lancamentos: LancamentoDaCarteira[] = (todosRes.data ?? []).map((l) => ({
    tipo: l.tipo as LancamentoDaCarteira["tipo"],
    amount_cents: Number(l.amount_cents),
    occurred_at: l.occurred_at as string,
  }));
  const saldo = derivarSaldo(lancamentos);

  const preco =
    precoRes.data?.preco_por_mensagem_cents === null ||
    precoRes.data?.preco_por_mensagem_cents === undefined
      ? null
      : Number(precoRes.data.preco_por_mensagem_cents);
  const alerta =
    precoRes.data?.alerta_saldo_cents === null || precoRes.data?.alerta_saldo_cents === undefined
      ? null
      : Number(precoRes.data.alerta_saldo_cents);

  /**
   * Quantas mensagens o saldo cobre — a frase que a tela precisa dizer antes de
   * alguém montar uma lista de 4.000 contatos. Com `destinatarios: 0` a trava
   * não julga lista nenhuma; ela só devolve a capacidade.
   */
  const capacidade = podeDisparar({
    saldoCents: saldo.saldo_cents,
    precoPorMensagemCents: preco,
    destinatarios: 0,
  });

  return ok(
    {
      saldo_cents: saldo.saldo_cents,
      creditado_cents: saldo.creditado_cents,
      debitado_cents: saldo.debitado_cents,
      estornado_cents: saldo.estornado_cents,
      preco_por_mensagem_cents: preco,
      // NULL aqui não é "ilimitado": é "ninguém combinou preço ainda", e a tela
      // tem de dizer isso, porque é o motivo pelo qual o disparo vai recusar.
      mensagens_que_cabem: capacidade.mensagens_que_cabem,
      credito_acabando: creditoAcabando(saldo.saldo_cents, alerta),
      alerta_saldo_cents: alerta,
      extrato: (extratoRes.data ?? []).map((l) => ({
        id: l.id as string,
        tipo: l.tipo as string,
        amount_cents: Number(l.amount_cents),
        currency: (l.currency as string) ?? "BRL",
        occurred_at: l.occurred_at as string,
        ref_kind: (l.ref_kind as string | null) ?? null,
        ref_id: (l.ref_id as string | null) ?? null,
        note: (l.note as string | null) ?? null,
      })),
      extrato_truncado: (extratoRes.data ?? []).length >= LINHAS_NA_TELA,
    },
    { requestId },
  );
}
