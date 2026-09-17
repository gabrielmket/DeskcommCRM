import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A CREDENCIAL DO CANAL SÓ PODE SER LIDA POR SERVICE ROLE — e a prova de que
 * ninguém consegue passar o client errado.
 *
 * ── O defeito que este teste tranca ─────────────────────────────────────────
 *
 * O token da Meta vive CIFRADO em `channel_sessions.meta_token_encrypted`, e a
 * migration 0116 é explícita:
 *
 *     revoke execute on function public.fn_decrypt_oauth(bytea) from authenticated;
 *     grant  execute on function public.fn_decrypt_oauth(bytea) to service_role;
 *
 * Ou seja: decifrar com o client do usuário é impossível POR CONSTRUÇÃO. E
 * `decryptWebhookSecret` devolve `null` quando a RPC recusa — então a recusa de
 * PERMISSÃO virava "esta sessão não tem token gravado", o código caía no `.env`,
 * e a rota concluía "nenhum canal oficial conectado". Com o canal conectado e
 * verde na tela, sem um erro em lugar nenhum.
 *
 * Três chamadores passavam o client do usuário: sincronizar templates, criar
 * template e enviar template pelo inbox. Medido em 17/09/2026, com o canal da
 * Time Company recém-conectado: "não consegui puxar os templates e nem subir".
 *
 * ── Por que o teste olha QUEM, e não o resultado ────────────────────────────
 *
 * Testar "devolve a credencial" passaria com o client errado em qualquer dublê
 * que não imite a recusa da RPC — e imitar a recusa seria transcrever a
 * migration para dentro do dublê, onde ela pode divergir calada. O invariante
 * verdadeiro é mais simples e não depende de dublê nenhum: a busca da
 * credencial acontece no client de SERVICE ROLE, e não no que o chamador tem
 * em mãos.
 *
 *     npx vitest run tests/unit/credencial-do-canal-exige-service-role.test.ts
 */

/**
 * Dublê mínimo: responde a consulta do canal e se deixa identificar.
 * `__quem` é o que o teste compara — o resto existe só para a consulta rodar.
 */
function clienteFalso(quem: string) {
  const linha = {
    meta_waba_id: "4660237264244026",
    meta_phone_number_id: "1331676193359349",
  };
  const cadeia: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit", "is"]) {
    cadeia[m] = () => cadeia;
  }
  cadeia.maybeSingle = async () => ({ data: linha, error: null });
  cadeia.__quem = quem;
  return cadeia;
}

const CLIENT_ADMIN = clienteFalso("service_role");
const CLIENT_DO_USUARIO = clienteFalso("authenticated");

const createAdminClient = vi.hoisted(() => vi.fn(() => CLIENT_ADMIN));
const resolveMetaCreds = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/channels/meta/credentials", () => ({ resolveMetaCreds }));

const { credenciaisDaOrg } = await import("@/lib/channels/meta/credenciais-da-org");

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";

beforeEach(() => {
  createAdminClient.mockClear().mockReturnValue(CLIENT_ADMIN);
  resolveMetaCreds.mockReset().mockResolvedValue({
    phoneNumberId: "1331676193359349",
    token: "tok",
    graphVersion: "v22.0",
    source: "session",
  });
});

describe("credenciaisDaOrg não aceita client de fora", () => {
  it("a assinatura tem UM argumento — não há onde enfiar o client errado", () => {
    expect(
      credenciaisDaOrg.length,
      "enquanto ela recebia um client, passar o do usuário era a forma de errar — e três chamadores erraram",
    ).toBe(1);
  });

  it("decifra no client de SERVICE ROLE", async () => {
    await credenciaisDaOrg(ORG);

    expect(createAdminClient, "sem service role a RPC de decifra é recusada").toHaveBeenCalled();
    const [clientUsado] = resolveMetaCreds.mock.calls[0] ?? [];
    expect(clientUsado).toBe(CLIENT_ADMIN);
    expect(clientUsado).not.toBe(CLIENT_DO_USUARIO);
  });

  it("o recorte por organização vai JUNTO — é ele que substitui a RLS contornada", async () => {
    await credenciaisDaOrg(ORG);

    const [, lookup] = resolveMetaCreds.mock.calls[0] ?? [];
    expect(
      (lookup as { organizationId: string }).organizationId,
      "service role bypassa RLS: sem o filtro à mão, a credencial de outra organização vazaria",
    ).toBe(ORG);
  });
});
