import { Suspense } from "react";
import { createHash } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import AcceptInvitation from "@/components/accept-invitation";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Uitnodiging | Deelrit",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

type Props = {
  params: Promise<{ token: string }>;
};

type InvitationRow = {
  organization_id: string;
  name: string;
  license_plate: string | null;
};

export default function InvitationPage({ params }: Props) {
  return (
    <Suspense fallback={<p>Uitnodiging laden…</p>}>
      <Invitation params={params} />
    </Suspense>
  );
}

async function Invitation({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <InvalidInvitation />;
  }

  const session = await getSession();

  if (!session) {
    const next = encodeURIComponent(`/uitnodiging/${token}`);
    redirect(`/login?next=${next}`);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const result = await db.query<InvitationRow>(
    `
      SELECT
        organization.id AS organization_id,
        organization.name,
        organization."licensePlate" AS license_plate
      FROM public.car_invitation_link AS invitation
      JOIN public.organization AS organization
        ON organization.id = invitation.organization_id
      WHERE invitation.token_hash = $1
        AND invitation.used_at IS NULL
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > NOW()
        AND EXISTS (
          SELECT 1
          FROM public.member
          WHERE "organizationId" = invitation.organization_id
            AND "userId" = invitation.created_by
            AND 'owner' = ANY(string_to_array(role, ','))
        )
    `,
    [tokenHash],
  );

  const invitation = result.rows[0];

  if (!invitation) {
    return <InvalidInvitation />;
  }

  const membership = await db.query(
    `
      SELECT id
      FROM public.member
      WHERE "organizationId" = $1
        AND "userId" = $2
    `,
    [invitation.organization_id, session.user.id],
  );

  const alreadyMember = Boolean(membership.rowCount);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={styles.logo}>
          deel<span>rit.</span>
        </Link>

        <p className={styles.eyebrow}>Je bent uitgenodigd</p>

        <h1 className={styles.title}>{invitation.name}</h1>

        {invitation.license_plate && (
          <p className={styles.plate}>{invitation.license_plate}</p>
        )}

        <p className={styles.description}>
          {alreadyMember
            ? "Je bent al lid van deze autogroep."
            : "Deel deze auto en houd samen jullie ritten en kosten bij."}
        </p>

        <p className={styles.identity}>
          Ingelogd als <strong>{session.user.name}</strong>
          <br />
          {session.user.email}
        </p>

        {alreadyMember ? (
          <Link
            href={`/auto/${invitation.organization_id}`}
            className={styles.primary}
          >
            Naar de auto
          </Link>
        ) : (
          <AcceptInvitation token={token} />
        )}

        <Link href="/" className={styles.secondary}>
          Terug naar mijn auto’s
        </Link>
      </div>
    </main>
  );
}

function InvalidInvitation() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link href="/" className={styles.logo}>
          deel<span>rit.</span>
        </Link>

        <h1 className={styles.title}>Link niet meer geldig.</h1>

        <p className={styles.description}>
          Deze uitnodiging is verlopen, ingetrokken of al gebruikt. Vraag een
          eigenaar om een nieuwe link.
        </p>

        <Link href="/" className={styles.primary}>
          Naar mijn auto’s
        </Link>
      </div>
    </main>
  );
}
