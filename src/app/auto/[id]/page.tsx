import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import GroupMembers from "@/components/group-members";
import InvitationLinks from "@/components/invitation-links";
import CarStartpoint from "@/components/car-startpoint";
import CarTrips from "@/components/car-trips";
import CarRefuels from "@/components/car-refuels";
import CarSettlement from "@/components/car-settlement";
import profileStyles from "@/app/page.module.css";
import styles from "./page.module.css";

type Props = {
  params: Promise<{ id: string }>;
};

type InvitationRow = {
  id: string;
  expires_at: Date;
};

type StartpointRow = {
  tank_date: string;
  odometer: number;
};

type TripRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  created_by: string;
  version: string;
  trip_date: string;
  ended_at: Date | null;
  start_odometer: number;
  end_odometer: number;
  description: string;
};

type RefuelRow = {
  id: string;
  paid_by: string;
  payer_name: string;
  created_by: string;
  version: string;
  tank_date: string;
  odometer: number;
  amount_cents: number;
  settled_at: Date | null;
};

export default function CarPage({ params }: Props) {
  return (
    <Suspense fallback={<p>Auto laden…</p>}>
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

  if (!car) {
    notFound();
  }

  const group = await auth.api.getFullOrganization({
    headers: requestHeaders,
    query: {
      organizationId: id,
    },
  });

  if (!group) {
    notFound();
  }

  const membership = group.members.find(
    (member) => member.userId === session.user.id,
  );

  if (!membership) {
    notFound();
  }

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

  const startpointResult = await db.query<StartpointRow>(
    `
        SELECT
          tank_date::text AS tank_date,
          odometer
        FROM public.car_startpoint
        WHERE organization_id = $1
      `,
    [id],
  );

  const startpointRow = startpointResult.rows[0];

  const startpoint = startpointRow
    ? {
        tankDate: startpointRow.tank_date,
        odometer: startpointRow.odometer,
      }
    : null;

  const tripResult = await db.query<TripRow>(
    `
        SELECT
          trip.id,
          trip.driver_id,
          trip.created_by,
          trip.updated_at::text AS version,
          driver.name AS driver_name,
          trip.trip_date::text AS trip_date,
          trip.ended_at,
          trip.start_odometer,
          trip.end_odometer,
          trip.description
        FROM public.car_trip AS trip
        JOIN public."user" AS driver
          ON driver.id = trip.driver_id
        WHERE trip.organization_id = $1
        ORDER BY trip.start_odometer ASC
      `,
    [id],
  );

  const trips = tripResult.rows.map((trip) => ({
    id: trip.id,
    driverId: trip.driver_id,
    driverName: trip.driver_name,
    createdBy: trip.created_by,
    version: trip.version,
    tripDate: trip.trip_date,
    endedAt: trip.ended_at?.toISOString() ?? null,
    startOdometer: trip.start_odometer,
    endOdometer: trip.end_odometer,
    description: trip.description,
  }));

  const refuelResult = await db.query<RefuelRow>(
    `
        SELECT
          refuel.id,
          refuel.paid_by,
          refuel.created_by,
          refuel.updated_at::text AS version,
          payer.name AS payer_name,
          refuel.tank_date::text AS tank_date,
          refuel.odometer,
          refuel.amount_cents,
          refuel.settled_at
        FROM public.car_refuel AS refuel
        JOIN public."user" AS payer
          ON payer.id = refuel.paid_by
        WHERE refuel.organization_id = $1
        ORDER BY refuel.odometer DESC
      `,
    [id],
  );

  const refuels = refuelResult.rows.map((refuel) => ({
    id: refuel.id,
    paidBy: refuel.paid_by,
    payerName: refuel.payer_name,
    createdBy: refuel.created_by,
    version: refuel.version,
    tankDate: refuel.tank_date,
    odometer: refuel.odometer,
    amountCents: refuel.amount_cents,
    settledAt: refuel.settled_at?.toISOString() ?? null,
  }));

  let invitations: {
    id: string;
    expiresAt: string;
  }[] = [];

  if (isOwner) {
    const result = await db.query<InvitationRow>(
      `
          SELECT
            invitation.id,
            invitation.expires_at
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
                AND 'owner' = ANY(
                  string_to_array(role, ',')
                )
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

            <h1 className={styles.title}>{car.name}</h1>

            <p className={styles.plate}>
              {car.licensePlate || "Geen nummerplaat ingevuld"}
            </p>
          </div>
        </div>

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
              trips={trips}
              refuels={refuels}
            />

            <CarRefuels
              organizationId={id}
              currentUserId={session.user.id}
              isOwner={isOwner}
              startOdometer={startpoint.odometer}
              startDate={startpoint.tankDate}
              today={today}
              payers={drivers}
              refuels={refuels}
            />

            <CarSettlement
              organizationId={id}
              currentUserId={session.user.id}
              isOwner={isOwner}
              startpoint={startpoint}
              trips={trips}
              refuels={refuels}
            />
          </>
        )}

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
