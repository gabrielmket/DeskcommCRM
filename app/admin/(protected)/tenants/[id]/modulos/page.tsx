import { ModulosDoTenant } from "@/components/admin/tenants/ModulosDoTenant";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantModulosPage({ params }: Props) {
  const { id } = await params;
  return <ModulosDoTenant organizationId={id} />;
}
