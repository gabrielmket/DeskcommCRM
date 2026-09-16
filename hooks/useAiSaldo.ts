"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface LancamentoDeSaldo {
  id: string;
  tipo: "recarga" | "leitura";
  amount_usd: number;
  occurred_at: string;
  note: string | null;
}

export interface SaldoDoProvedor {
  /** Nulo enquanto não houver nenhuma LEITURA: sem âncora não há saldo — e zero se leria como "acabou". */
  saldo_usd: number | null;
  leitura: { amount_usd: number; occurred_at: string } | null;
  recargas_desde_leitura_usd: number;
  consumo_desde_leitura_usd: number;
  media_diaria_usd: number;
  consumo_30d_usd: number;
  dias_restantes: number | null;
  dura_ate: string | null;
  lancamentos: LancamentoDeSaldo[];
  cotacao: { usd_brl: number; cotado_em: string | null } | null;
  chamadas_sem_preco: number;
}

const CHAVE = ["admin", "ai-saldo"] as const;

export function useAiSaldo() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () =>
      apiClient.get<{ data: SaldoDoProvedor }>("/api/v1/admin/ai-saldo").then((r) => r.data),
    staleTime: 60 * 1000,
  });
}

export function useLancarSaldo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      tipo: "recarga" | "leitura";
      amount_usd: number;
      occurred_at?: string;
      note?: string;
    }) => apiClient.post<{ data: LancamentoDeSaldo }>("/api/v1/admin/ai-saldo", corpo),
    // O saldo é derivado: qualquer lançamento muda também o painel de uso.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
      void qc.invalidateQueries({ queryKey: ["admin", "usage"] });
    },
  });
}

export function useApagarLancamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ data: { id: string } }>(`/api/v1/admin/ai-saldo/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useDefinirCotacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (usd_brl: number) =>
      apiClient.patch<{ data: { usd_brl: number } }>("/api/v1/admin/ai-saldo", { usd_brl }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
      void qc.invalidateQueries({ queryKey: ["admin", "usage"] });
    },
  });
}
