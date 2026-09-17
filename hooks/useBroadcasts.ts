"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface AndamentoDaCampanha {
  total: number;
  pendente?: number;
  enviada?: number;
  entregue?: number;
  lida?: number;
  falhou?: number;
  estornada?: number;
}

export interface Campanha {
  id: string;
  nome: string;
  template_name: string;
  template_language: string;
  status: "rascunho" | "agendada" | "enviando" | "pausada" | "concluida" | "cancelada";
  preco_cents: number | null;
  agendado_para: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  motivo_da_parada: string | null;
  created_at: string;
  andamento: AndamentoDaCampanha;
}

export interface CampanhaCriada {
  id: string;
  destinatarios: number;
  fora: { sem_telefone: number; repetidos: number; pediram_para_sair: number };
  pode_disparar: boolean;
  motivo: string | null;
  falta_cents: number | null;
  custo_estimado_cents: number | null;
}

export function useBroadcasts() {
  return useQuery({
    queryKey: ["broadcasts"],
    queryFn: async () => apiClient.get<{ data: { campanhas: Campanha[] } }>("/api/v1/broadcasts"),
    select: (r) => r.data.campanhas,
    // Campanha em curso muda sozinha (o cron manda a cada minuto): sem isto a
    // tela ficaria parada mostrando "0 enviadas" com o disparo andando.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useCriarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      template_name: string;
      template_language: string;
      valores_padrao: Record<string, string>;
      tags: string[];
      variavel_do_nome: string | null;
    }) => apiClient.post<{ data: CampanhaCriada }>("/api/v1/broadcasts", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });
}

export function useDispararCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.post<{ data: { id: string; status: string; na_fila: number } }>(
        `/api/v1/broadcasts/${id}/disparar`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
      // O saldo cai junto com o disparo; sem isto a tela de Créditos mentiria.
      void qc.invalidateQueries({ queryKey: ["carteira"] });
    },
  });
}
