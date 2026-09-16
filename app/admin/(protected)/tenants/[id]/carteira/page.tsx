import { CarteiraDoTenant } from "@/components/admin/tenants/CarteiraDoTenant";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TenantCarteiraPage({ params }: Props) {
  const { id } = await params;
  return <CarteiraDoTenant organizationId={id} />;
}
