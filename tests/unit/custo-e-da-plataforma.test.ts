/**
 * A LINHA QUE SEPARA O QUE É DO CLIENTE DO QUE É DA PLATAFORMA.
 *
 * Decisão desta instalação (Time Company, 15/09/2026): quem paga o provedor de
 * IA é quem opera a plataforma, e o cliente contrata ATENDIMENTO, não tokens.
 * Mostrar o custo a ele seria mostrar o preço de custo do que ele compra.
 *
 * O que estes casos prendem, nesta ordem de importância:
 *
 *  1. o dado sai na API, não no componente — esconder um número que a resposta
 *     ainda carrega é esconder de quem não abre o devtools;
 *  2. ausência de custo é NULO, nunca zero: zero se lê como "não custou nada",
 *     que é exatamente a leitura falsa que este fork foi consertar;
 *  3. tokens CONTINUAM visíveis. Consumo não é preço, e é o medidor do dia em
 *     que o plano for por conversa ou por pacote — o cliente precisa ver o que
 *     gastou do pacote dele sem ver o que isso nos custou;
 *  4. sessão de acompanhamento (`support`) entra na conta do cliente para
 *     ajudar, e não para ver o custo dela.
 */
import { describe, expect, it } from "vitest";

import { podeVerCusto, semCusto } from "@/lib/ai/custo-e-da-plataforma";
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { canSee } from "@/lib/navigation/interface";

const daPlataforma = { is_platform_admin: true, support: null };
const doCliente = { is_platform_admin: false, support: null };

describe("quem enxerga dinheiro", () => {
  it("admin de plataforma vê", () => {
    expect(podeVerCusto(daPlataforma)).toBe(true);
  });

  it("admin do cliente NÃO vê, por mais alto que seja o papel dele no tenant", () => {
    expect(podeVerCusto(doCliente)).toBe(false);
  });

  it("acompanhamento (support) não vê: entrou para ajudar, não para medir o custo", () => {
    expect(
      podeVerCusto({
        is_platform_admin: true,
        support: { organization_id: "org-1" } as never,
      }),
    ).toBe(false);
  });
});

describe("o custo sai da resposta, não da tela", () => {
  const linhas = [
    { id: "a", input_tokens: 46_000, output_tokens: 400, cost_cents: 9.68 },
    { id: "b", input_tokens: 300, output_tokens: 16, cost_cents: 0.08 },
  ];

  it("para o cliente, cada linha volta sem valor — e o resto intacto", () => {
    const vistas = semCusto(linhas, false);
    expect(vistas.map((l) => l.cost_cents)).toEqual([null, null]);
    // O que ele continua vendo é o consumo, que é o medidor do pacote futuro.
    expect(vistas.map((l) => l.input_tokens)).toEqual([46_000, 300]);
    expect(vistas.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("nulo, e não zero: zero se leria como 'a IA não custou nada'", () => {
    expect(semCusto(linhas, false)[0]?.cost_cents).not.toBe(0);
  });

  it("para a plataforma, nada é removido", () => {
    expect(semCusto(linhas, true)).toEqual(linhas);
  });

  it("não modifica o array original — a mesma lista pode servir aos dois públicos", () => {
    semCusto(linhas, false);
    expect(linhas[0]?.cost_cents).toBe(9.68);
  });
});

describe("o destino 'Uso e orçamento' é da plataforma", () => {
  // `NAV_CATALOG` é tupla literal (`as const`): lido pelo TIPO do catálogo, e não
  // pelo literal de cada entrada, o campo opcional existe em todas elas.
  const catalogo: readonly NavMetadata[] = NAV_CATALOG;
  const uso = catalogo.find((d) => d.href === "/app/ai/usage");

  it("existe e está marcado como somentePlataforma", () => {
    expect(uso?.somentePlataforma).toBe(true);
  });

  it("nem o admin do cliente enxerga o destino no menu", () => {
    expect(canSee(uso!, false, "admin")).toBe(false);
  });

  it("quem administra a plataforma enxerga", () => {
    expect(canSee(uso!, true, null)).toBe(true);
  });

  it("a marca não vazou para outros destinos: o resto do menu segue por papel", () => {
    const marcados = catalogo.filter((d) => d.somentePlataforma === true).map((d) => d.href);
    expect(marcados).toEqual(["/app/ai/usage"]);
  });
});
