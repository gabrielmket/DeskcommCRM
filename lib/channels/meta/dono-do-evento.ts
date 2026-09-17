/**
 * DE QUEM É ESTE EVENTO — a pergunta que o webhook da Meta faz a cada item.
 *
 * A URL de callback do app é UMA SÓ, e o token nela aponta para UMA sessão.
 * Enquanto existe uma conta WhatsApp só, o token responde tudo. A partir da
 * segunda, ele passa a ser um palpite, e havia dois jeitos de esse palpite
 * errar:
 *
 *  1. O evento é de outra WABA. Chega com o token da primeira, e a versão
 *     antiga o DESCARTAVA em silêncio — sem erro, sem linha, a mensagem
 *     simplesmente não existia.
 *  2. O token não resolve mais nada. Basta o canal daquele token ser
 *     arquivado — o que é natural ao trocar o número de teste pelo
 *     definitivo — e a rota passava a recusar TUDO, de todas as contas, com
 *     404, antes de olhar o corpo.
 *
 * O segundo é o pior dos dois: o primeiro perde uma conta, o segundo derruba
 * a instalação inteira e o defeito parece estar no número novo.
 *
 * A resposta certa vem da WABA que a Meta carimba no corpo. Isso NÃO é confiar
 * no payload para escolher tenant: quem chama esta função já provou, pelo HMAC
 * com o App Secret, que quem falou foi a Meta — e a tradução WABA → organização
 * é a nossa tabela, nunca o corpo.
 */

export type DonoDeEvento = { organizationId: string; wabaId?: string | null };

export async function donoDoEvento<T extends DonoDeEvento>(args: {
  /** A sessão que o token do caminho resolveu. `null` = token órfão. */
  sessionDoToken: T | null;
  /** A WABA que a Meta carimbou neste evento. */
  wabaDoEvento?: string | null;
  /** Quem traduz WABA → sessão. Só é chamado quando o token não serve. */
  porWaba: (wabaId: string) => Promise<T | null>;
}): Promise<T | null> {
  const { sessionDoToken: peloToken, wabaDoEvento: waba } = args;

  /**
   * O token serve quando resolveu ALGO e nada o contradiz.
   *
   * "Nada o contradiz" inclui os dois casos em que não há o que comparar:
   * evento sem WABA (a Meta nem sempre carimba) e sessão antiga sem `waba_id`
   * gravado. Exigir a igualdade nesses casos quebraria instalações de uma conta
   * só, que são a maioria — e onde o token nunca esteve errado.
   */
  const tokenServe = peloToken !== null && (!waba || !peloToken.wabaId || waba === peloToken.wabaId);
  if (tokenServe) return peloToken;

  // Sem WABA no corpo não há segunda pergunta a fazer. `null` aqui significa
  // "ignore este evento", não "erro": quem chama responde 200 do mesmo jeito,
  // porque a Meta reentrega em backoff tudo que não recebe 2xx.
  if (!waba) return null;

  return await args.porWaba(waba);
}
