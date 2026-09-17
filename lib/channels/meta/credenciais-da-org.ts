import { queryTolerantToMissingArchived, ARCHIVED_AT } from "@/lib/channels/archived";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *
 * ── Por que ela CRIA o client em vez de receber um ──────────────────────────
 *
 * Porque receber era a forma de errar, e erramos: as rotas de template passavam
 * o client do USUÁRIO. O token vive cifrado, e `fn_decrypt_oauth` é
 * `revoke execute ... from authenticated` / `grant ... to service_role`
 * (migration 0116) — decifrar com o client do usuário é impossível por
 * construção. Pior: `decryptWebhookSecret` devolve `null` quando a RPC recusa,
 * então a falha de permissão virava "esta sessão não tem token", caía no `.env`,
 * e a rota concluía "nenhum canal conectado" com o canal verde na tela. Nenhum
 * erro, em lugar nenhum — o MESMO sintoma que esta função existe para consertar,
 * uma camada abaixo.
 *
 * Passar a criar o client aqui não amplia privilégio: o recorte por organização
 * já era feito À MÃO (`.eq("organization_id", …)`) justamente porque o service
 * role bypassa RLS, e o `organizationId` continua vindo de quem já autorizou o
 * pedido. O que muda é que deixa de existir um jeito de o chamador errar.
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
  organizationId: string,
): Promise<CredenciaisDaOrg | null> {
  // Service role de propósito: ver o cabeçalho. O filtro por organização abaixo
  // é o que substitui a RLS que este client contorna.
  const db = createAdminClient();
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
