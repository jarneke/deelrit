import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { CarOverviewAccessError, loadCarOverview } from "@/lib/car-overview";
import { logServerError } from "@/lib/server-error";
import GroupMembers from "@/components/group-members";
import InvitationLinks from "@/components/invitation-links";
import CarStartpoint from "@/components/car-startpoint";
import CarTrips from "@/components/car-trips";
import CarRefuels from "@/components/car-refuels";
import CarSettlement from "@/components/car-settlement";
import CarStatementHistory from "@/components/car-statement-history";
import CarSettings from "@/components/car-settings";
import CarCalendar from "@/components/car-calendar";
import LoadingState from "@/components/loading-state";
import settingsStyles from "@/components/car-settings.module.css";
import profileStyles from "@/app/page.module.css";
import styles from "./page.module.css";

type Props = {
  params: Promise<{ id: string }>;
};

type InvitationRow = {
  id: string;
  expires_at: Date;
};

export default function CarPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <LoadingState
          title="Je auto laden…"
          description="We halen de ritten, tankbeurten en afrekening op."
        />
      }
    >
      <CarOverview params={params} />
    </Suspense>
  );
}

async function CarOverview({ params }: Props) {
  const session = await requireSession();
  const requestHeaders = await headers();
  const { id } = await params;

  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  });

  const car = organizations.find((organization) => organization.id === id);

  if (!car) notFound();

  const group = await auth.api.getFullOrganization({
    headers: requestHeaders,
    query: { organizationId: id },
  });

  if (!group) notFound();

  const membership = group.members.find(
    (member) => member.userId === session.user.id,
  );

  if (!membership) notFound();

  const initials =
    session.user.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  const isOwner = membership.role
    .split(",")
    .map((role) => role.trim())
    .includes("owner");

  const overview = await loadCarOverview(id, session.user.id).catch(
    (error: unknown) => {
      if (error instanceof CarOverviewAccessError) {
        notFound();
      }

      logServerError("CarOverview", error);

      throw new Error(
        "De autogegevens konden niet worden geladen. Probeer opnieuw.",
      );
    },
  );

  const startpoint = overview.startpoint;

  let invitations: { id: string; expiresAt: string }[] = [];

  if (isOwner) {
    const result = await db.query<InvitationRow>(
      `
        SELECT invitation.id, invitation.expires_at
        FROM public.car_invitation_link AS invitation
        WHERE invitation.organization_id = $1
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
        ORDER BY invitation.created_at DESC
      `,
      [id],
    );

    invitations = result.rows.map((invitation) => ({
      id: invitation.id,
      expiresAt: invitation.expires_at.toISOString(),
    }));
  }

  const members = group.members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    role: member.role,
  }));

  const drivers = members.map((member) => ({
    userId: member.userId,
    name: member.name,
  }));

  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Brussels",
  }).format(new Date());

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>
            ← Mijn auto’s
          </Link>

          <Link
            href="/account"
            className={profileStyles.avatar}
            aria-label={`Account van ${session.user.name}`}
          >
            {initials}
          </Link>
        </header>

        <div className={styles.carHeader}>
          <div className={styles.carIcon} aria-hidden="true">
            ↔
          </div>

          <div className={styles.identity}>
            <p className={styles.eyebrow}>Gedeelde auto</p>

            <div className={settingsStyles.titleRow}>
              <h1 className={styles.title}>{car.name}</h1>

              {isOwner && (
                <CarSettings
                  key={id}
                  organizationId={id}
                  name={car.name}
                  licensePlate={car.licensePlate ?? null}
                />
              )}
            </div>

            <p className={styles.plate}>
              {car.licensePlate || "Geen nummerplaat ingevuld"}
            </p>
          </div>
        </div>

        <CarCalendar
          key={id}
          organizationId={id}
          currentUserId={session.user.id}
          isOwner={isOwner}
          today={today}
        />

        <CarStartpoint
          organizationId={id}
          isOwner={isOwner}
          startpoint={startpoint}
        />

        {startpoint && (
          <>
            <CarTrips
              organizationId={id}
              currentUserId={session.user.id}
              isOwner={isOwner}
              startOdometer={startpoint.odometer}
              startDate={startpoint.tankDate}
              today={today}
              drivers={drivers}
              latestTrip={overview.latestTrip}
              tripCount={overview.tripCount}
              totalDistance={overview.totalDistance}
              gaps={overview.gaps}
              historyRevision={overview.tripHistoryRevision}
            />

            <CarRefuels
              organizationId={id}
              currentUserId={session.user.id}
              isOwner={isOwner}
              startOdometer={startpoint.odometer}
              startDate={startpoint.tankDate}
              today={today}
              payers={drivers}
              latestRefuel={overview.latestRefuel}
              refuelCount={overview.refuelCount}
              historyRevision={overview.refuelHistoryRevision}
            />

            {overview.settlementOverview && (
              <CarSettlement
                organizationId={id}
                currentUserId={session.user.id}
                isOwner={isOwner}
                overview={overview.settlementOverview}
              />
            )}
          </>
        )}

        <CarStatementHistory
          organizationId={id}
          key={overview.statementHistoryRevision}
        />

        <GroupMembers
          organizationId={id}
          currentUserId={session.user.id}
          members={members}
        />

        {isOwner && (
          <InvitationLinks organizationId={id} invitations={invitations} />
        )}
      </div>
    </main>
  );
}
