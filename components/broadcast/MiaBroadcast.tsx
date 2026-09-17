"use client";

/**
 * MIA BROADCAST — montar, conferir e disparar.
 *
 * ── Duas telas num fluxo só, e a ordem é o produto ──────────────────────────
 *
 * Criar NÃO dispara. A campanha nasce em rascunho e a tela mostra a peneira:
 * quantos entraram, quantos ficaram de fora e por quê. Só então aparece o botão
 * de disparar, com o custo estimado ao lado.
 *
 * Juntar as duas coisas (um botão "criar e disparar") tiraria o único momento
 * em que dá para descobrir que 900 dos 4.000 contatos não têm telefone — e essa
 * descoberta depois do disparo não serve para nada.
 *
 * ── O que a tela recusa, e por quê ──────────────────────────────────────────
 *
 * Template não aprovado, saldo que não cobre a lista, lista vazia. Cada recusa
 * vem com o motivo em português e, quando é saldo, com quanto falta — recusar
 * sem dizer quanto recarregar obriga a pessoa a fazer a conta de cabeça.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useTemplates } from "@/hooks/channels/useTemplates";
import { useCarteira } from "@/hooks/useCarteira";
import {
  useBroadcasts,
  useCriarCampanha,
  useDispararCampanha,
  type Campanha,
  type CampanhaCriada,
} from "@/hooks/useBroadcasts";
import { formatCentsBRL } from "@/lib/money";

const ROTULO_DO_STATUS: Record<Campanha["status"], string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

const MOTIVO: Record<string, string> = {
  sem_preco_acordado: "Ainda não há preço por mensagem acordado para esta empresa.",
  saldo_insuficiente: "O crédito não cobre a lista inteira.",
  template_nao_aprovado: "Este template ainda não foi aprovado pela Meta.",
  sem_canal: "Nenhum número oficial conectado.",
  numero_em_risco: "O número está com qualidade baixa na Meta — disparar agora acelera o bloqueio.",
  lista_vazia: "Nenhum contato entrou na lista.",
  saldo_acabou: "O crédito acabou no meio do disparo.",
};

export function MiaBroadcast() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data: campanhas, isLoading } = useBroadcasts();
  const { data: templatesRes } = useTemplates();
  const { data: carteira } = useCarteira();
  const criar = useCriarCampanha();
  const disparar = useDispararCampanha();

  const [nome, setNome] = useState("");
  const [template, setTemplate] = useState("");
  const [tags, setTags] = useState("");
  const [recemCriada, setRecemCriada] = useState<CampanhaCriada | null>(null);

  // Só APPROVED entra no seletor: oferecer um pendente seria montar uma campanha
  // que a própria tela recusaria na hora de disparar.
  const aprovados = (templatesRes?.data.templates ?? []).filter((x) => x.status === "APPROVED");

  function montar() {
    const escolhido = aprovados.find((x) => `${x.name}:${x.language}` === template);
    if (!nome.trim() || !escolhido) {
      toast.error(t("Dê um nome e escolha um template aprovado."));
      return;
    }
    criar.mutate(
      {
        nome: nome.trim(),
        template_name: escolhido.name,
        template_language: escolhido.language,
        valores_padrao: {},
        tags: tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        variavel_do_nome: "1",
      },
      {
        onSuccess: (r) => {
          setRecemCriada(r.data);
          setNome("");
        },
        onError: (e: unknown) => {
          toast.error(e instanceof Error ? e.message : t("Não consegui montar a campanha."));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm font-medium">{t("Nova campanha")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {carteira?.preco_por_mensagem_cents == null
            ? t("Sem preço por mensagem acordado — fale com quem cuida da sua conta antes de montar.")
            : `${t("Saldo:")} ${formatCentsBRL(carteira.saldo_cents)} · ${formatCentsBRL(
                carteira.preco_por_mensagem_cents,
              )} ${t("por mensagem")}`}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="bc-nome">{t("Nome da campanha")}</Label>
            <Input
              id="bc-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("Retomada setembro")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bc-tpl">{t("Template aprovado")}</Label>
            <select
              id="bc-tpl"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">{t("Escolha…")}</option>
              {aprovados.map((x) => (
                <option key={`${x.name}:${x.language}`} value={`${x.name}:${x.language}`}>
                  {x.name} ({x.language})
                </option>
              ))}
            </select>
            {aprovados.length === 0 ? (
              <p className="text-xs text-warning-fg">
                {t("Nenhum template aprovado ainda — crie um em Conexões › Templates da Meta.")}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="bc-tags">{t("Filtrar por tags (opcional)")}</Label>
            <Input
              id="bc-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="vip, retomada"
            />
            <p className="text-xs text-muted-foreground">
              {t("Vazio = todos os contatos com telefone.")}
            </p>
          </div>
        </div>

        <Button className="mt-3" onClick={montar} disabled={criar.isPending}>
          {criar.isPending ? t("Montando…") : t("Montar lista")}
        </Button>
      </section>

      {recemCriada ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{t("Confira antes de disparar")}</h2>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {recemCriada.destinatarios} {t("destinatários")}
          </p>
          {/* A peneira INTEIRA: lista que encolhe sem explicação parece defeito
              do sistema, e cada número aqui é informação sobre a base. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Ficaram de fora:")} {recemCriada.fora.sem_telefone} {t("sem telefone")} ·{" "}
            {recemCriada.fora.repetidos} {t("repetidos")} · {recemCriada.fora.pediram_para_sair}{" "}
            {t("pediram para sair")}
          </p>
          {recemCriada.custo_estimado_cents !== null ? (
            <p className="mt-2 text-sm">
              {t("Custo estimado:")}{" "}
              <strong className="tabular-nums">
                {formatCentsBRL(recemCriada.custo_estimado_cents)}
              </strong>
            </p>
          ) : null}

          {recemCriada.pode_disparar ? (
            <Button
              className="mt-3"
              disabled={disparar.isPending}
              onClick={() =>
                disparar.mutate(recemCriada.id, {
                  onSuccess: () => {
                    toast.success(t("Disparo começou. O envio acontece em segundo plano."));
                    setRecemCriada(null);
                  },
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : t("Não consegui disparar.")),
                })
              }
            >
              {disparar.isPending ? t("Disparando…") : t("Disparar agora")}
            </Button>
          ) : (
            <p className="mt-3 text-sm text-error-fg">
              {t(MOTIVO[recemCriada.motivo ?? ""] ?? "Não dá para disparar ainda.")}
              {recemCriada.falta_cents
                ? ` ${t("Faltam")} ${formatCentsBRL(recemCriada.falta_cents)}.`
                : ""}
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t("Campanhas")}</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
        ) : (campanhas ?? []).length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            {t("Nenhuma campanha ainda.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {(campanhas ?? []).map((c) => (
              <div key={c.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.nome}</span>
                  <span className="rounded-sm border px-1.5 py-0.5 text-xs">
                    {t(ROTULO_DO_STATUS[c.status])}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.template_name}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString(tag)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {c.andamento.total} {t("na lista")} · {c.andamento.enviada ?? 0} {t("enviadas")} ·{" "}
                  {c.andamento.entregue ?? 0} {t("entregues")} · {c.andamento.falhou ?? 0}{" "}
                  {t("falhas")} · {c.andamento.pendente ?? 0} {t("na fila")}
                </p>
                {c.motivo_da_parada ? (
                  <p className="mt-1 text-xs text-warning-fg">
                    {t(MOTIVO[c.motivo_da_parada] ?? c.motivo_da_parada)}
                  </p>
                ) : null}
                {c.status === "pausada" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    disabled={disparar.isPending}
                    onClick={() =>
                      disparar.mutate(c.id, {
                        onSuccess: () => toast.success(t("Disparo retomado.")),
                        onError: (e: unknown) =>
                          toast.error(e instanceof Error ? e.message : t("Não consegui retomar.")),
                      })
                    }
                  >
                    {t("Retomar")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
