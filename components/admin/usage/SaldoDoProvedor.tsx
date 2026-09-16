"use client";

/**
 * SALDO DA CONTA DO PROVEDOR — e os lançamentos que o explicam.
 *
 * Quando o crédito acaba, a chave continua válida e a chamada volta recusada: o
 * sintoma chega como "a IA parou de responder", e ninguém liga uma coisa à
 * outra. Esta seção existe para esse dia não chegar de surpresa.
 *
 * O saldo não é digitado: é derivado da última LEITURA (o valor que estava na
 * conta do provedor num instante), mais as RECARGAS depois dela, menos o consumo
 * medido desde então. Por isso ele cai sozinho enquanto os agentes trabalham, e
 * uma leitura nova reancora tudo — inclusive o erro acumulado da nossa medição.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAiSaldo,
  useApagarLancamento,
  useDefinirCotacao,
  useLancarSaldo,
  type SaldoDoProvedor as Saldo,
} from "@/hooks/useAiSaldo";

function usd(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

function brl(v: number, taxa: number): string {
  return (v * taxa).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function Cartao({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe: string; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? "border-amber-500/60" : ""}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-amber-600 dark:text-amber-500" : ""}`}>
        {valor}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function Cartoes({ s }: { s: Saldo }) {
  const taxa = s.cotacao?.usd_brl ?? null;
  const acabaCedo = s.dias_restantes !== null && s.dias_restantes <= 7;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Cartao
        titulo="Saldo estimado"
        valor={s.saldo_usd === null ? "—" : usd(s.saldo_usd)}
        detalhe={
          s.saldo_usd === null
            ? "registre uma leitura de saldo para começar"
            : taxa
              ? `${brl(s.saldo_usd, taxa)} na cotação registrada`
              : "conta do provedor"
        }
        alerta={acabaCedo}
      />
      <Cartao
        titulo="Última leitura"
        valor={s.leitura ? usd(s.leitura.amount_usd) : "—"}
        detalhe={s.leitura ? `conferida em ${dia(s.leitura.occurred_at)}` : "nenhuma leitura registrada"}
      />
      <Cartao
        titulo="Consumido desde então"
        valor={usd(s.consumo_desde_leitura_usd)}
        detalhe={
          s.recargas_desde_leitura_usd > 0
            ? `${usd(s.recargas_desde_leitura_usd)} recarregados depois`
            : "medido pelas chamadas do período"
        }
      />
      <Cartao
        titulo="Dura até"
        valor={s.dura_ate ? dia(s.dura_ate) : "—"}
        detalhe={
          s.dias_restantes === null
            ? "sem ritmo medido nos últimos 30 dias"
            : `${usd(s.media_diaria_usd)}/dia · ${Math.floor(s.dias_restantes)} dia(s)`
        }
        alerta={acabaCedo}
      />
    </div>
  );
}

function Formulario() {
  const lancar = useLancarSaldo();
  const [tipo, setTipo] = useState<"recarga" | "leitura">("recarga");
  const [valor, setValor] = useState("");
  const [quando, setQuando] = useState("");
  const [nota, setNota] = useState("");

  const numero = Number(valor.replace(",", "."));
  const valido = Number.isFinite(numero) && numero >= 0 && valor.trim() !== "";

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        lancar.mutate(
          {
            tipo,
            amount_usd: numero,
            ...(quando ? { occurred_at: new Date(quando).toISOString() } : {}),
            ...(nota.trim() ? { note: nota.trim() } : {}),
          },
          {
            onSuccess: () => {
              setValor("");
              setNota("");
              setQuando("");
            },
          },
        );
      }}
    >
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-tipo">
          Tipo
        </label>
        <select
          id="saldo-tipo"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "recarga" | "leitura")}
        >
          <option value="recarga">Recarga (crédito que entrou)</option>
          <option value="leitura">Leitura (saldo conferido na conta)</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-valor">
          Valor em US$
        </label>
        <Input
          id="saldo-valor"
          className="w-32"
          inputMode="decimal"
          placeholder="30,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-quando">
          Quando (opcional)
        </label>
        {/* A DATA DO FATO, não a da digitação: recarga lançada dois dias depois
            precisa contar do dia certo, senão o saldo do intervalo sai errado. */}
        <Input
          id="saldo-quando"
          type="date"
          className="w-40"
          value={quando}
          onChange={(e) => setQuando(e.target.value)}
        />
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="saldo-nota">
          Observação (opcional)
        </label>
        <Input
          id="saldo-nota"
          placeholder="cartão da empresa"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!valido || lancar.isPending}>
        {lancar.isPending ? "Registrando…" : "Registrar"}
      </Button>
      {lancar.isError ? (
        <p className="w-full text-xs text-destructive">Não consegui registrar. Tente de novo.</p>
      ) : null}
    </form>
  );
}

function Cotacao({ atual }: { atual: { usd_brl: number; cotado_em: string | null } | null }) {
  const definir = useDefinirCotacao();
  const [valor, setValor] = useState("");
  const numero = Number(valor.replace(",", "."));
  const valido = Number.isFinite(numero) && numero > 0;

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) definir.mutate(numero, { onSuccess: () => setValor("") });
      }}
    >
      <div className="space-y-1">
        <label className="block text-xs text-muted-foreground" htmlFor="cotacao">
          Cotação do dólar
        </label>
        <Input
          id="cotacao"
          className="w-28"
          inputMode="decimal"
          placeholder={atual ? String(atual.usd_brl) : "5,45"}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={!valido || definir.isPending}>
        Atualizar
      </Button>
      <p className="text-xs text-muted-foreground">
        {atual
          ? `Em uso: R$ ${atual.usd_brl}${atual.cotado_em ? ` · de ${dia(atual.cotado_em)}` : ""}`
          : "Sem cotação: os valores aparecem em dólar."}
      </p>
    </form>
  );
}

function Lancamentos({ linhas }: { linhas: Saldo["lancamentos"] }) {
  const apagar = useApagarLancamento();
  if (linhas.length === 0) {
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        Nenhum lançamento ainda. Comece registrando uma leitura: o saldo que está hoje na conta do
        provedor.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Data</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2 text-right">Valor</th>
            <th className="px-3 py-2">Observação</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="px-3 py-2 tabular-nums">{dia(l.occurred_at)}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    l.tipo === "recarga"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  }`}
                >
                  {l.tipo}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {l.tipo === "recarga" ? "+" : ""}
                {usd(l.amount_usd)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{l.note ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={apagar.isPending}
                  onClick={() => apagar.mutate(l.id)}
                >
                  Excluir
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SaldoDoProvedorSecao() {
  const { data, isLoading, isError } = useAiSaldo();

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Saldo e recarga do provedor</h2>
        <p className="text-xs text-muted-foreground">
          O saldo se atualiza sozinho: cai conforme os agentes trabalham e sobe quando você registra
          uma recarga. Registre uma leitura sempre que conferir a conta do provedor — ela corrige
          qualquer diferença acumulada.
        </p>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-lg border" />
      ) : isError || !data ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Não consegui ler o saldo agora.
        </p>
      ) : (
        <>
          <Cartoes s={data} />
          <Cotacao atual={data.cotacao} />
          <Formulario />
          <Lancamentos linhas={data.lancamentos} />
        </>
      )}
    </section>
  );
}
