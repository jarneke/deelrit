import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { getCarPhotoSource } from "@/lib/github-images";
import GlassRefractionTest from "@/components/glass-refraction-test";

type Props = {
  params: Promise<{ id: string }>;
};

export default function GlassTestPage({ params }: Props) {
  return (
    <Suspense fallback={<p>Glasproef laden…</p>}>
      <AuthenticatedGlassTest params={params} />
    </Suspense>
  );
}

async function AuthenticatedGlassTest({ params }: Props) {
  await requireSession();
  const { id } = await params;

  const organizations = await auth.api.listOrganizations({
    headers: await headers(),
  });

  const car = organizations.find((organization) => organization.id === id);

  if (!car) notFound();

  return (
    <GlassRefractionTest
      photoSource={getCarPhotoSource(id, car.logo ?? null)}
      backHref={"/auto/" + encodeURIComponent(id)}
    />
  );
}
