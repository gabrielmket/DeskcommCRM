import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O ALERTA MORRE ONDE NASCEU.
 *
 * Auditoria de 18/09/2026, defeito 3a. `workers/rag-indexer.ts` ABRIA o aviso
 * `conhecimento_nao_indexado` na Central e, ao concluir a indexação, marcava a
 * FONTE como pronta — sem nenhum update em `agent_inbox_items`. Não existia
 * função que resolvesse este `kind` em lugar nenhum do repositório: o alerta era
 * imortal até alguém fechar à mão.
 *
 * Evidência de produção: `agent_inbox_items d73a8e56…` `open` desde 03:21,
 * enquanto a fonte referenciada estava `ready` desde 04:22. O custo não foi
 * estético — durante a investigação daquele dia este alerta levou a um
 * diagnóstico ERRADO, desmentido só depois de ler `ai_knowledge_sources` direto.
 * Aviso que sobrevive à condição que o criou não é ruído neutro: é evidência
 * falsa.
 *
 * ⚠️ `janela_de_envio_fechada` JÁ TEM resolvedor e ele está certo
 * (`resolverAvisoDeJanela`, chamado no mesmo ponto do turno que abriria o
 * aviso). Um segundo caminho de fechamento criaria duas réguas que divergem na
 * primeira mudança — e é por isso que este arquivo cobra o resolvedor do RAG e
 * não toca no da janela.
 *
 * ## Por que a asserção é sobre o FONTE
 *
 * O que se quer prender é uma relação de ORDEM dentro de uma função: o
 * fechamento acontece no ramo do sucesso, depois de carimbar a fonte. Um teste
 * de comportamento com cliente falso mediria o falso; o laço, aqui, é uma
 * propriedade do arquivo.
 */

const FONTE = readFileSync(join(process.cwd(), "workers", "rag-indexer.ts"), "utf8");

describe("rag-indexer: quem abre o aviso também o fecha", () => {
  it("existe um resolvedor, e ele resolve o MESMO kind que o worker abre", () => {
    expect(FONTE).toContain('const KIND_AVISO = "conhecimento_nao_indexado"');
    expect(FONTE).toMatch(/async function resolverAvisoDaFonte/);

    // Guarda de vacuidade: sem isto, renomear a constante faria as asserções
    // abaixo passarem por ausência de dado.
    const usosDaConstante = [...FONTE.matchAll(/KIND_AVISO/g)].length;
    expect(usosDaConstante).toBeGreaterThanOrEqual(3); // declaração + abrir + fechar
  });

  it("o literal solto não voltou — abrir e fechar leem a MESMA constante", () => {
    // O modo de falha que a constante existe para impedir: alguém muda o kind na
    // abertura, esquece o fechamento, e o alerta volta a ser imortal em silêncio.
    const literaisSoltos = [...FONTE.matchAll(/kind: "conhecimento_nao_indexado"/g)].length;
    expect(literaisSoltos).toBe(0);
  });

  it("o fechamento acontece no ramo do SUCESSO, depois de carimbar a fonte", () => {
    const ramoOk = FONTE.indexOf('if (resultado.tipo === "ok")');
    expect(ramoOk).toBeGreaterThan(-1);

    const chamada = FONTE.indexOf("await resolverAvisoDaFonte(", ramoOk);
    expect(chamada, "o resolvedor não é chamado no ramo de sucesso").toBeGreaterThan(ramoOk);

    // E antes do `return` daquele ramo — se estivesse depois, nunca rodaria.
    const retorno = FONTE.indexOf("return {", ramoOk);
    expect(chamada).toBeLessThan(retorno);
  });

  it("resolve `ack` junto com `open` — ler o aviso não é consertar o problema", () => {
    expect(FONTE).toMatch(/\.in\("status", \["open", "ack"\]\)/);
  });

  it("o update filtra organization_id à mão (service_role passa por cima da RLS)", () => {
    const corpo = FONTE.slice(
      FONTE.indexOf("async function resolverAvisoDaFonte"),
      FONTE.indexOf("async function resolverAvisoDaFonte") + 1200,
    );
    expect(corpo).toContain('.eq("organization_id", organizationId)');
  });
});
