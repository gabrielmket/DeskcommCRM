import { expect, it, describe, vi } from 'vitest';
import type pg from 'pg';

import { drainTick } from '@/lib/agent-engine/edge/crm/drain';
import { haInboundNaoRespondido } from '@/lib/agent-engine/agent/inbound-turn';
import type { LeadContextMessage } from '@/lib/agent-engine/edge/crm/get-lead-context';

/**
 * O TURNO ADIADO VIRAVA RALO.
 *
 * Medido na implantação do tenant Academia Body Fit (18/09/2026), e é a
 * composição de duas peças que, sozinhas, estão certas:
 *
 *   1. `inbound-turn.ts` ADIA o turno quando a janela anti-ban está fechada. O
 *      job vai para `run_after` = abertura da janela — que às 22h de um sábado é
 *      daqui a nove horas. Isso é o comportamento desejado: melhor o cliente ser
 *      atendido às 7h do que o número ser banido.
 *
 *   2. `drain.ts` COALESCE rajada: mensagem que chega enquanto já existe um job
 *      pendente do mesmo contato entra de carona nele, e o evento vira `done`.
 *      Isso também é desejado — quem manda "oi", "tudo bem?", "queria saber o
 *      preço" em três segundos merece UMA resposta, não três.
 *
 * O ralo nasce onde as duas se encontram. A condição da coalescência era
 * `run_after > now()`, sem teto: um job adiado por 300 ms de debounce e um
 * adiado por nove horas são indistinguíveis para ela. Com a janela fechada,
 * TODA mensagem seguinte do contato era marcada processada sem virar turno.
 *
 * ## As duas cercas, e por que são duas
 *
 * **Horizonte.** O teto é o próprio `debounceMs` — a janela que a coalescência
 * existe para cobrir. Fora dela a carona deixa de ser carona.
 *
 * **Mesma conversa.** A chave era só `contact_id`, e o turno responde na conversa
 * PINADA no payload do job. O mesmo contato falando em dois canais tinha a
 * segunda mensagem pendurada num job que responde na primeira conversa — e a
 * segunda nunca recebia turno. Aqui a mensagem não atrasava: sumia.
 *
 * ## Por que a asserção é sobre o SQL
 *
 * A cerca É a cláusula. Um pool falso não tem relógio nem linhas, então medir
 * "o job foi coalescido?" mediria o falso, não o drain. O que este arquivo
 * prende é o CONTRATO com o Postgres — as duas cláusulas e os dois parâmetros —,
 * e o controle negativo abaixo prova que a forma ANTIGA reprovaria.
 */

const knobs = {
  batchSize: 10,
  intervalMs: 0,
  idleIntervalMs: 0,
  debounceMs: 8000,
  reapTimeoutMs: 60000,
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

const CONVERSA = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';

const evento = {
  id: 'e1',
  organization_id: 'org1',
  attempts: 1,
  created_at: new Date().toISOString(),
  payload: {
    conversation_id: CONVERSA,
    contact_id: CONTATO,
    channel_session_id: '33333333-3333-4333-8333-333333333333',
    inbound_message_id: '44444444-4444-4444-8444-444444444444',
  },
};

interface Chamada {
  sql: string;
  params: unknown[];
}

/** Roda um tick e devolve tudo que foi perguntado ao banco, com os parâmetros. */
async function rodarTick(): Promise<Chamada[]> {
  const chamadas: Chamada[] = [];
  const query = vi.fn().mockImplementation((sql: string, params: unknown[] = []) => {
    chamadas.push({ sql, params });
    if (sql.includes('returning e.id')) return { rows: [evento] };
    if (sql.includes('ai_dispatch_mode')) return { rows: [{ mode: null }] };
    if (sql.includes('is_group')) return { rows: [{ is_group: false }] };
    if (sql.includes('tem_agente')) return { rows: [{ tem_agente: true, tem_roteador: false }] };
    if (sql.includes('media_derived_status')) {
      return { rows: [{ type: 'text', media_derived_status: null }] };
    }
    if (sql.includes('insert into job_queue')) return { rows: [{ id: 'j1' }] };
    return { rows: [] };
  });
  await drainTick({ query } as unknown as pg.Pool, knobs, log);
  return chamadas;
}

/** A consulta que procura job pendente para coalescer — e só ela. */
function consultaDeCoalescencia(chamadas: Chamada[]): Chamada {
  const achada = chamadas.find(
    (c) => c.sql.includes('job_queue') && c.sql.includes("kind = 'inbound_turn'"),
  );
  // Guarda de vacuidade: sem ela, um refactor que renomeasse a consulta faria
  // todas as asserções abaixo passarem por ausência de dado.
  expect(achada, 'consulta de coalescência não encontrada no tick do drain').toBeDefined();
  return achada as Chamada;
}

describe('coalescência: o turno adiado não engole a mensagem seguinte', () => {
  it('a consulta tem TETO de horizonte, e o teto é o debounce', async () => {
    const c = consultaDeCoalescencia(await rodarTick());

    expect(c.sql).toContain('run_after > now()');
    // A cerca. `make_interval(secs => …)` e não `interval '… ms'`: o valor é
    // parâmetro, e concatenar literal de intervalo em SQL é o caminho curto
    // para injeção e para erro de tipo em ms fracionário.
    expect(c.sql).toContain('run_after <= now() + make_interval');
    expect(c.params).toContain(knobs.debounceMs);
  });

  it('a consulta é da MESMA conversa, não só do mesmo contato', async () => {
    const c = consultaDeCoalescencia(await rodarTick());

    expect(c.sql).toContain("payload->>'conversation_id'");
    expect(c.params).toContain(CONVERSA);
  });

  it('controle negativo: a forma ANTIGA da consulta reprovaria', () => {
    // A condição exata que estava em produção. Ela casa `run_after > now()` e
    // NÃO casa nenhuma das duas cercas — é o que o teste precisa enxergar para
    // não ser verde por acaso.
    const antiga = `select id from job_queue
       where organization_id = $1 and contact_id = $2
         and kind = 'inbound_turn' and status = 'pending' and run_after > now()
       limit 1`;

    expect(antiga).toContain('run_after > now()');
    expect(antiga).not.toContain('run_after <= now() + make_interval');
    expect(antiga).not.toContain("payload->>'conversation_id'");
  });
});

/**
 * O CINTO DO CONSERTO.
 *
 * Com a cerca no lugar, N mensagens numa noite de janela fechada viram N jobs,
 * todos soltos na abertura. O primeiro responde ao que o cliente disse — o turno
 * lê o histórico inteiro, não só a mensagem pinada. Os seguintes chegariam com a
 * conversa JÁ respondida e mandariam o modelo falar por cima da própria resposta.
 *
 * `haInboundNaoRespondido` é o que os cala. Ela NÃO é
 * `inboundsNaoRespondidos().length > 0`: aquela devolve texto e descarta corpo
 * vazio de propósito, e áudio cuja transcrição falhou é exatamente uma inbound de
 * corpo vazio — o turno que responde "recebi seu áudio, mas não consigo ouvi-lo"
 * precisa acontecer.
 */
describe('haInboundNaoRespondido: quem cala o turno repetido', () => {
  const msg = (direction: 'inbound' | 'outbound', body: string): LeadContextMessage =>
    ({ direction, body, sent_at: '2026-09-18T09:00:00-03:00' }) as unknown as LeadContextMessage;

  it('cliente falou por último → há o que responder', () => {
    expect(haInboundNaoRespondido([msg('outbound', 'Oi!'), msg('inbound', 'quanto custa?')])).toBe(
      true,
    );
  });

  it('nós falamos por último → nada esperando', () => {
    expect(haInboundNaoRespondido([msg('inbound', 'quanto custa?'), msg('outbound', 'R$ 90')])).toBe(
      false,
    );
  });

  it('resposta de HUMANO também conta como nossa — o agente não fala por cima', () => {
    // O corte é a direção, não o autor. É o caso em que responder de novo é pior:
    // o atendente já assumiu a conversa.
    expect(
      haInboundNaoRespondido([
        msg('inbound', 'quero falar com alguém'),
        msg('outbound', 'Oi, aqui é a Ana, vou te ajudar'),
      ]),
    ).toBe(false);
  });

  it('áudio sem transcrição (corpo VAZIO) ainda é inbound não respondida', () => {
    // A armadilha que obrigou a função própria: `inboundsNaoRespondidos`
    // devolveria [] aqui, e usá-la como guarda calaria o turno que existe para
    // dizer ao cliente que o áudio não pôde ser ouvido.
    expect(haInboundNaoRespondido([msg('outbound', 'Oi!'), msg('inbound', '')])).toBe(true);
  });

  it('conversa sem mensagem nenhuma → nada a responder', () => {
    expect(haInboundNaoRespondido([])).toBe(false);
  });
});
