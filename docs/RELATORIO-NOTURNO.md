# Relatório noturno — 18/09/2026

Branch `defeitos-pacing`, seis commits sobre `f3daa7a`. **Nada foi implantado e
nada foi para a `main`** — o deploy é seu, no EasyPanel.

> ⚠️ **O `git push` foi RECUSADO.** `403: Claude doesn't have GitHub access to
> gabrielmket/mia for your organization`. Leitura funciona (`git fetch`, API);
> só a escrita é barrada. O conserto é instalar o app em
> <https://github.com/apps/claude/installations/select_target> ou reconectar o
> GitHub em <https://claude.ai/customize/connectors>. Enquanto isso não
> acontece, a branch existe só no contêiner desta sessão, que é efêmero — por
> isso ela foi enviada a você também como **bundle** (`defeitos-pacing.bundle`).
> Para aplicar, com a `main` em `f3daa7a`:
>
> ```bash
> git fetch defeitos-pacing.bundle defeitos-pacing:defeitos-pacing
> ```

---

## Antes de tudo: duas coisas que você precisa saber

### 1. O relatório que eu deveria ler tem TRÊS defeitos, não seis

`docs/audits/2026-09-18-pacing-janela-adiada-e-alertas-fantasma.md` documenta os
defeitos **1, 2 e 3 (3a/3b)**. Os defeitos **4** (coalescência engolindo turno
adiado) e **5** (`crm_save_org_memory`) **não estão escritos nele** — chegaram só
na sua instrução, com arquivo e linha.

Conferi os dois direto no código antes de mexer, e os dois são reais. Mas ficam
duas perguntas para você:

- existe uma versão mais nova da auditoria que não foi commitada?
- `.claude/skills/sistema-mia/SKILL.md`, que a instrução manda ler primeiro,
  **não existe neste repositório**. As skills presentes são as seis
  `deskcomm-*` mais `sistema-vivo`. Trabalhei sem esse mapa — se ele tem
  armadilhas que já custaram caro, eu não as vi.

### 2. A `main` está VERMELHA no gate `invariants`, e não fui eu

Isso é o achado mais importante da noite e não tem nada a ver com o meu trabalho.
Subi um Postgres de verdade, apliquei o `baseline.sql` e rodei a suíte de
invariantes inteira — nos DOIS lados, na minha branch e na `main` pura, para ter
controle. **Os mesmos três arquivos falham nos dois**, pelas mesmas razões, todas
vindas das migrations 0243–0247 (metas, carteira, disparador, módulos):

| Arquivo | O que ele acusa |
|---|---|
| `on-conflict-aponta-para-constraint-real` | `app/api/v1/metas/route.ts` faz `ON CONFLICT (organization_id, periodo, metrica, user_id, agent_id)` e o índice único de `sales_targets` é sobre **expressões** (`coalesce(user_id, …)`). O PostgREST não casa os dois. |
| `rls-completude-varredura` | 6 tabelas tenant-aware sem prova comportamental de RLS: `broadcasts`, `broadcast_recipients`, `organization_modules`, `sales_targets`, `tenant_broadcast_pricing`, `tenant_wallet_ledger` |
| `lgpd-cascata-alcanca-quem-guarda-pessoa` | `broadcast_recipients` guarda `phone_e164` com FK para `contacts` e está fora de `fn_lgpd_cascade_redact_contact` — anonimizar devolve sucesso e o telefone continua legível |

O primeiro é um **defeito de produto que já está no ar**: redefinir a meta do mês
de alguém que já tem meta falha com `42P10`. O caminho normal — "o número muda no
meio do trimestre", que é o comentário do próprio código — é o que quebra.

**Não consertei nenhum dos três**, porque nenhum estava na lista e os três pedem
decisão: o de metas é trocar o índice ou a chamada (o índice está certo e a
chamada é que não sabe expressar `coalesce`; trocar o índice muda semântica de
NULL); o de RLS é escrever seis provas; o de LGPD é decidir se telefone de
disparo entra na cascata ou vira dívida declarada — e isso é conversa de
compliance, não de código.

---

## O que consertei

### Defeito 4 — turno adiado virava ralo · `3f4b30f`

A coalescência do drain casava `run_after > now()` sem teto. Um job adiado por
300 ms de debounce e um adiado por nove horas pela janela anti-ban eram a mesma
coisa para ela: com a janela fechada, toda mensagem seguinte do contato era
marcada processada e entregue a um turno lá na frente.

Achei um segundo ralo no mesmo lugar, **pior que o relatado**: a chave era só
`contact_id`, e o turno responde na conversa PINADA no payload do job. O mesmo
contato falando em dois canais tinha a segunda mensagem pendurada num job que
responde na PRIMEIRA conversa. Ali a mensagem não atrasava — sumia de verdade.

Duas cercas: horizonte (`run_after <= now() + debounceMs`, como o relatório
sugeriu) e mesma conversa.

**A cerca sozinha teria criado defeito pior, e isso é a parte que eu quero que
você leia.** Com ela, N mensagens numa noite de janela fechada viram N jobs,
todos soltos na abertura. O primeiro responde a tudo (o turno lê o histórico
inteiro, não só a mensagem pinada); os seguintes chegam com a conversa já
respondida e mandam o modelo falar por cima da própria resposta. Uma mensagem
atrasada é o preço da janela; três respostas repetidas às 7h da manhã seriam pior
que o defeito consertado.

Por isso entrou junto `haInboundNaoRespondido`: o turno encerra ANTES do modelo
quando nada do cliente está esperando. Ela não é `inboundsNaoRespondidos().length
> 0` — aquela descarta corpo vazio de propósito, e áudio com transcrição falhada
é exatamente uma inbound de corpo vazio; usá-la calaria o turno que responde
"recebi seu áudio, mas não consigo ouvi-lo".

A regra vale sozinha: "a última saída nossa" inclui resposta de HUMANO, e falar
por cima do atendente que assumiu é o caso em que responder de novo é pior ainda.

### Defeitos 2 e 1 — alargar a janela destrava · `6cbab4b`

O PUT de `/api/v1/ai/pacing` agora traz para agora os `inbound_turn` daquele
canal que estavam adiados **pela janela**.

Para AGORA e não para a nova abertura: calcular a abertura ali repetiria, num
segundo lugar, a regra de `janelaDeEnvioAberta`/`proximaAberturaDaJanela`, e duas
réguas divergem na primeira mudança. O turno roda, reavalia com os knobs novos e
ou responde ou se adia sozinho. Isso não custa IA — o gate da janela roda antes
de resolver agente e antes de qualquer chamada ao modelo.

Isso **fecha o 3b de graça**, como o relatório previu. Não escrevi segundo
resolvedor para `janela_de_envio_fechada`.

O passo anterior: `job_queue.deferred_reason` (0251), vocabulário fechado com par
em TypeScript no mesmo commit. Só `janela_anti_ban` é reprogramado —
`horario_do_agente` depende da versão publicada do agente e `canal_fora` de a
sessão WAHA voltar; trazê-los junto os adiaria de novo no mesmo segundo.

E o gatilho de `updated_at` em `channel_knobs` (0250), com a função
`fn_set_updated_at()` que já servia outras trinta e poucas tabelas.

### Defeito 5 — `crm_save_org_memory` · `acda636`

**A decisão que você pediu que eu explicasse.** Aliei o BANCO ao código: o CHECK
passou a aceitar `agent`.

O conserto barato seria trocar o handler para `'manual'` — uma linha, sem
migration. Recusei porque ele destrói a única coisa que a coluna existe para
responder. A descrição da própria ferramenta, que o modelo lê, promete "nasce com
origem 'agent' para o humano distinguir o que a IA anotou do que ele mesmo
escreveu". A tela de Memória da IA mostra política que TODOS os agentes obedecem
em qualquer conversa: fazer a anotação da IA chegar lá indistinguível do que um
gestor digitou é trocar um erro ruidoso (a ferramenta falha e o agente sabe) por
um erro silencioso (ela grava e mente sobre a autoria). Política da empresa é
exatamente o tipo de texto em que essa diferença decide se alguém confere antes
de obedecer.

`source` já é a coluna de procedência — `flywheel` existe justamente para separar
o que a destilação propôs do que uma pessoa escreveu. `agent` é o terceiro caso
legítimo da mesma pergunta.

Alargar CHECK é seguro em banco existente: nenhuma linha viola o conjunto maior,
então o `update.sh` de todo clone passa.

**Achei um efeito colateral que o relatório não menciona:** o badge da tela era um
ternário de duas origens, e tudo que não fosse `flywheel` virava "manual". Sem
mexer nele, consertar a ferramenta teria produzido exatamente a mentira que a
migration argumenta contra. Agora são três, com "anotado pela IA" e tradução em
espanhol.

### Defeito 3a — o alerta de conhecimento · `e911f88`

`resolverAvisoDaFonte` fecha o aviso no ramo do sucesso da indexação — no mesmo
ponto que o abriria, que é onde se sabe sem adivinhar que a condição acabou.
Mesma regra de `resolverAvisoDeJanela`; varredura por cron seria um segundo lugar
onde a regra vive.

`ack` é resolvido junto com `open`: alguém ter LIDO o aviso não é alguém ter
consertado o problema.

**Não escrevi resolvedor para `janela_de_envio_fechada`** — ele existe e está
certo, como o relatório avisa em letras garrafais.

### A saída pela tela · `200befa`

O conserto do defeito 2 destravava os turnos em silêncio: quem alargasse a janela
continuaria vendo "Proteção de envio atualizada.", igualzinho a antes. A pessoa
que abriu a ficha justamente porque nada respondia não teria como saber que desta
vez respondeu. O toast passa a dizer o número.

E quando não deu para conferir, diz isso. A rota devolve `null` para "não sei",
nunca `0` — afirmar "nenhum atendimento esperando" sobre algo que ninguém mediu é
literalmente o defeito 1 de novo, numa camada acima.

---

## Como verifiquei

| O quê | Resultado |
|---|---|
| `npx tsc --noEmit -p tsconfig.typecheck.json` | zerado |
| `npm run lint` | zerado |
| `npx vitest run` | **820 arquivos, 8.669 testes, 0 falhas** (partida: 817 / 8.641) |
| `baseline.sql` em Postgres real, modo **install** (`ON_ERROR_STOP=1`) | passa |
| `baseline.sql` re-aplicado, modo **update** (idempotência) | passa |
| Suíte de invariantes (189 arquivos) contra esse banco | 186 passam; as 3 falhas são as da `main`, provadas com controle |

Rodei as duas sondas de contagem que o `CLAUDE.md` manda comparar (rodapé do
vitest × `grep FAIL`), e elas batem: 0 e 0.

**O que NÃO consegui verificar**, e você precisa saber antes de implantar:

- **Não há Docker nesta máquina.** `pnpm test:db` não roda. Contornei subindo um
  Postgres **16** local (o piso declarado é o **15**) com `pgvector` e os stubs de
  Supabase extraídos do próprio `scripts/test-db.sh`, e ponteando o `docker exec`
  da suíte para o `psql` local. É prova boa, mas não é o gate.
- **Nenhuma prova de tela.** Sem `next build` + Supabase local + Playwright, a
  doutrina de QA Visual não foi cumprida para as duas mudanças de UI (o badge da
  memória e o toast do anti-ban). São mudanças pequenas e de texto, mas não foram
  vistas por um browser.
- Provei os três consertos de schema com SQL direto no banco real, incluindo
  controles negativos (os CHECKs recusam valor fora do vocabulário, e `manual` e
  `flywheel` continuam aceitos).

---

## O que NÃO fiz, e por quê

1. **Os três invariantes vermelhos da `main`** — ver a seção do começo. Pedem
   decisão sua, e nenhum estava na lista.
2. **A varredura "quem fecha cada `kind` de alerta"** que a auditoria sugere junto
   do 3a. Não estava na sua lista de prioridades, e é trabalho de tamanho
   próprio: são 20+ kinds no CHECK de `agent_inbox_items`. Dois de dois auditados
   tinham problema, então a chance de haver mais é alta. Vale virar item no
   backlog.
3. **A "alternativa de superfície" do defeito 2** — a tela listando "há N turnos
   adiados para `<hora>`" com botão "liberar agora". O relatório a oferece como
   complemento, não substituto. O toast entrega o essencial (o operador sabe que
   funcionou) sem tela nova; a lista continua fazendo sentido se você quiser ver
   o estado sem mexer em nada.
4. **Bloco C e E6** — intocados, como você mandou.

---

## Decisões que tomei sozinho (e que você pode reverter)

- **Coalescência também passou a exigir MESMA CONVERSA.** Não estava na correção
  sugerida. Fiz porque, investigando, vi que esse é um ralo real e pior — a
  mensagem no outro canal não atrasa, ela nunca é respondida. Se você achar que
  isso é o item B1 do backlog e deve ir junto com ele, é só tirar a linha do
  `payload->>'conversation_id'`.
- **`haInboundNaoRespondido` cala turno sem nada pendente.** É o cinto descrito
  acima. Muda comportamento além do defeito 4: hoje, um `inbound_turn` cuja
  conversa já foi respondida por um HUMANO ainda chama o modelo. Passa a não
  chamar. Acho isso certo por si só, mas é mudança de comportamento e você deve
  saber que ela está aí.
- **`deferred_reason` nasceu com CHECK** em vez de vocabulário aberto. Segui o
  padrão do `CLAUDE.md`; a exceção de vocabulário aberto existe para colunas com
  valor legado em clones, e aqui toda linha existente é NULL.
- **Falha de reprogramação devolve `null` e não derruba o PUT.** Quando essa etapa
  roda, o upsert dos knobs JÁ aconteceu; responder "falha ao salvar" mandaria a
  pessoa tentar de novo contra um estado que já mudou.

---

## Perguntas que precisam de você

1. **Existe versão mais nova da auditoria, com os seis defeitos?** E o
   `.claude/skills/sistema-mia/SKILL.md` deveria estar commitado?
2. **O `ON CONFLICT` de `sales_targets`** — trocar o índice (perde a semântica de
   `coalesce` para NULL) ou trocar a chamada (resolver na rota: `select` + `update`
   ou `insert`, ou uma função no banco)? Está quebrado em produção agora.
3. **`broadcast_recipients.phone_e164` entra na cascata de LGPD** ou vira dívida
   declarada em `DIVIDA_LGPD_CONHECIDA` com razão e prazo? O telefone sobrevive à
   anonimização hoje, e a rota de anonimização devolve sucesso.
4. **As seis tabelas sem prova de RLS** — quer que eu escreva as provas numa
   próxima sessão?
5. **Quer a tela de "turnos adiados"** (item 3 acima) ou o toast basta?

---

## Para implantar

Nada a fazer no `.env`. As três migrations estão em `supabase/migrations/`, com
espelho no apêndice do `baseline.sql` e linha no `MANIFEST.md`. O fragmento de
release está em `.changes/` e declara `impacto: nada_mudou` → `1.21.0 + patch =
1.21.1` (conferido com `pnpm release:conferir`).

Os seis commits:

```
200befa feat(pacing): a tela diz quantos atendimentos voltaram para a fila
e911f88 fix(conhecimento): o aviso de material não indexado morre onde nasceu
acda636 fix(mcp): a IA volta a conseguir anotar aprendizado da empresa
6cbab4b fix(pacing): alargar a janela destrava o turno que estava esperando por ela
3f4b30f fix(pacing): a mensagem seguinte não entra de carona num turno adiado por horas
```
