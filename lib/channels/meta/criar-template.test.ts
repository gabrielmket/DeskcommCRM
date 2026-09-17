import { describe, expect, it } from "vitest";

import {
  componentesDaMeta,
  criarTemplate,
  nomeValido,
  variaveisDoCorpo,
} from "@/lib/channels/meta/criar-template";

/**
 * O FORMATO QUE A META ACEITA — conferido aqui, não no ar.
 *
 * Componente malformado volta como 400 genérico, sem dizer o que está errado, e
 * cada tentativa entra na fila de análise dela. Descobrir o formato por
 * tentativa e erro custa dias de aprovação, e é por isso que a montagem é uma
 * função pura com teste em vez de um objeto inline no meio do `fetch`.
 *
 *     npx vitest run lib/channels/meta/criar-template.test.ts
 */

describe("as regras que a Meta recusa em silêncio", () => {
  it("nome só aceita minúscula, número e _", () => {
    expect(nomeValido("mia_primeiro_contato")).toBe(true);
    expect(nomeValido("MIA Primeiro Contato"), "maiúscula e espaço são 400 opaco").toBe(false);
    expect(nomeValido("mia-primeiro")).toBe(false);
    expect(nomeValido("")).toBe(false);
  });

  it("conta as variáveis do corpo, e a repetida conta uma vez", () => {
    expect(variaveisDoCorpo("Olá, {{1}}! Aqui é {{2}}.")).toBe(2);
    expect(
      variaveisDoCorpo("Olá {{1}}, tudo bem {{1}}?"),
      "a mesma variável duas vezes exige UM exemplo, não dois",
    ).toBe(1);
    expect(variaveisDoCorpo("sem variável nenhuma")).toBe(0);
    expect(variaveisDoCorpo("com espaço {{ 1 }} também vale")).toBe(1);
  });
});

describe("o corpo que vai para a Graph API", () => {
  it("exemplos vão como lista de LISTAS — o formato plano é recusado", () => {
    const c = componentesDaMeta({
      name: "t",
      language: "pt_BR",
      category: "MARKETING",
      body: "Olá, {{1}}! Aqui é {{2}}.",
      exemplos: ["Gabriel", "Rafa"],
    });
    const corpo = c.find((x) => x.type === "BODY")!;
    expect(
      corpo.example,
      "example.body_text tem que ser [[...]]; plano volta 400 sem dizer o motivo",
    ).toEqual({ body_text: [["Gabriel", "Rafa"]] });
  });

  it("corpo sem variável NÃO leva example — mandar um vazio também é recusa", () => {
    const c = componentesDaMeta({
      name: "t",
      language: "pt_BR",
      category: "UTILITY",
      body: "Sua reunião está confirmada.",
    });
    expect(c.find((x) => x.type === "BODY")!.example).toBeUndefined();
  });

  it("botões viram QUICK_REPLY, no máximo 3", () => {
    const c = componentesDaMeta({
      name: "t",
      language: "pt_BR",
      category: "MARKETING",
      body: "oi",
      botoes: ["Parar promoções", "Quero saber mais", "Agendar", "Quarto que sobra"],
    });
    const b = c.find((x) => x.type === "BUTTONS") as { buttons: Array<{ type: string; text: string }> };
    expect(b.buttons).toHaveLength(3);
    expect(b.buttons[0]).toEqual({ type: "QUICK_REPLY", text: "Parar promoções" });
  });

  it("header e footer entram só quando têm texto", () => {
    const semNada = componentesDaMeta({
      name: "t",
      language: "pt_BR",
      category: "MARKETING",
      body: "oi",
      header: "   ",
      footer: "",
    });
    expect(semNada.map((c) => c.type)).toEqual(["BODY"]);
  });
});

describe("a recusa acontece ANTES de gastar uma submissão", () => {
  const base = { wabaId: "1", token: "t", graphVersion: "v22.0", language: "pt_BR" } as const;

  it("nome inválido não chega na Meta", async () => {
    const r = await criarTemplate({
      ...base,
      name: "Nome Errado",
      category: "MARKETING",
      body: "oi",
    });
    expect(r.criado).toBe(false);
    if (!r.criado) expect(r.motivo).toBe("nome_invalido");
  });

  it("variável sem exemplo não chega na Meta", async () => {
    const r = await criarTemplate({
      ...base,
      name: "mia_teste",
      category: "MARKETING",
      body: "Olá, {{1}}! Aqui é {{2}}.",
      exemplos: ["só um"],
    });
    expect(
      r.criado,
      "submissão incompleta entra na fila de análise e volta reprovada dias depois",
    ).toBe(false);
    if (!r.criado) expect(r.motivo).toBe("exemplos_faltando");
  });
});
