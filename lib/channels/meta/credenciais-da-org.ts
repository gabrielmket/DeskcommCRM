import type { SupabaseClient } from "@supabase/supabase-js";

import { queryTolerantToMissingArchived, ARCHIVED_AT } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { resolveMetaCreds } from "./credentials";

/**
 * A credencial da Meta desta organização, tirada do CANAL que ela conectou.
 *
 * Existe porque três caminhos (sincronizar templates, criar template, enviar
 * template) liam `META_SYSTEM_USER_TOKEN` do ambiente — e uma variável de
 * ambiente é UMA. Numa instalação com N clientes, cada um conecta o número
 * dele pela tela, e o env não tem como servir aos dois: o primeiro cliente
 * funcionava e todos os outros recebiam `missing_meta_token` com o canal
 * conectado e verde na tela.
 *
 * O fallback para o ambiente continua, e é o que mantém de pé a instalação de
 * número único que nunca conectou pela tela.
 */
export interface CredenciaisDaOrg {
  wabaId: string;
  phoneNumberId: string;
  token: string;
  graphVersion: string;
  /** De onde veio — é o que se olha quando alguém pergunta "por qual número saiu?". */
  origem: "session" | "env";
}

export async function credenciaisDaOrg(
  db: SupabaseClient,
  organizationId: string,
): Promise<CredenciaisDaOrg | null> {
  const base = () =>
    db
      .from("channel_sessions")
      .select("meta_waba_id, meta_phone_number_id")
      .eq("organization_id", organizationId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .order("created_at", { ascending: true })
      .limit(1);

  const { data } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  const wabaId = (data?.meta_waba_id as string | null) ?? process.env.META_WABA_ID ?? "";
  const phoneNumberId =
    (data?.meta_phone_number_id as string | null) ?? process.env.META_PHONE_NUMBER_ID ?? "";
  if (!wabaId || !phoneNumberId) return null;

  const creds = await resolveMetaCreds(db, { organizationId, phoneNumberId });
  if (!creds) return null;

  return {
    wabaId,
    phoneNumberId: creds.phoneNumberId,
    token: creds.token,
    graphVersion: creds.graphVersion,
    origem: creds.source,
  };
}
