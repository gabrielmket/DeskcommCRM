"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface ModuloDoTenant {
  chave: string;
  rotulo: string;
  descricao: string;
  liberado: boolean;
  granted_at: string | null;
  note: string | null;
  telas: string[];
}

export function useModulosDoTenant(organizationId: string) {
  return useQuery({
    queryKey: ["admin", "modulos", organizationId],
    queryFn: async () =>
      apiClient.get<{ data: { organization_id: string; modulos: ModuloDoTenant[] } }>(
        `/api/v1/admin/modulos?organization_id=${encodeURIComponent(organizationId)}`,
      ),
    select: (r) => r.data,
    staleTime: 15_000,
  });
}

export function useLiberarModulo(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modulo: string) =>
      apiClient.post("/api/v1/admin/modulos", { organization_id: organizationId, modulo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "modulos", organizationId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao liberar o módulo.");
    },
  });
}

export function useCancelarModulo(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modulo: string) =>
      apiClient.delete(
        `/api/v1/admin/modulos?organization_id=${encodeURIComponent(organizationId)}&modulo=${encodeURIComponent(modulo)}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "modulos", organizationId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar o módulo.");
    },
  });
}
