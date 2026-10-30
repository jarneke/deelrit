import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { CarOverviewAccessError, loadCarOverview } from "@/lib/car-overview";
import { logServerError } from "@/lib/server-error";
import { getCarPhotoSource, getProfilePhotoSource } from "@/lib/github-images";
import { formatTripPayers } from "@/lib/car-trip-payers";
import UserAvatar from "@/components/user-avatar";
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
import AppIcon from "@/components/app-icon";
import CarHero from "@/components/car-hero";
import CarWorkspace from "@/components/car-workspace";
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

  const profileRows = await db.query<{
    id: string;
    image: string | null;
  }>('SELECT id, image FROM public."user" WHERE id = ANY($1::text[])', [
    group.members.map((member) => member.userId),
  ]);

  const avatarSources = new Map(
    profileRows.rows.map((person) => [
      person.id,
      getProfilePhotoSource(person.id, person.image),
    ]),
  );

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
  const photoUrl = car.logo ?? null;
  const photoSource = getCarPhotoSource(id, photoUrl);

  const latestOdometer = startpoint
    ? Math.max(
        startpoint.odometer,
        overview.latestTrip?.endOdometer ?? startpoint.odometer,
        overview.latestRefuel?.odometer ?? startpoint.odometer,
      )
    : null;

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
    photoSource: avatarSources.get(member.userId) ?? null,
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
          <Link
            href="/"
            className={styles.back}
            aria-label="Terug naar mijn auto’s"
          >
            <AppIcon name="arrow-left" />
            <span>Mijn auto’s</span>
          </Link>

          <Link
            href="/"
            className={styles.brand}
            aria-label="Deelrit — mijn auto’s"
          >
            deelrit<span>.</span>
          </Link>

          <Link
            href="/account"
            className={styles.avatar}
            aria-label={"Account van " + session.user.name}
          >
            <UserAvatar
              name={session.user.name}
              source={avatarSources.get(session.user.id) ?? null}
            />
          </Link>
        </header>

        <CarWorkspace
          key={id}
          photoSource={photoSource}
          statisticsHref={"/auto/" + encodeURIComponent(id) + "/statistieken"}
          hero={
            <CarHero
              name={car.name}
              licensePlate={car.licensePlate ?? null}
              photoSource={photoSource}
              odometer={latestOdometer}
              memberCount={members.length}
              tripCount={overview.tripCount}
              actions={
                isOwner ? (
                  <CarSettings
                    key={id}
                    organizationId={id}
                    name={car.name}
                    licensePlate={car.licensePlate ?? null}
                    photoUrl={photoUrl}
                    photoSource={photoSource}
                  />
                ) : null
              }
            />
          }
          startpoint={
            <CarStartpoint
              organizationId={id}
              isOwner={isOwner}
              startpoint={startpoint}
            />
          }
          trips={
            startpoint ? (
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
            ) : null
          }
          refuels={
            startpoint ? (
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
            ) : null
          }
          recent={
            <>
              <h2>Laatste activiteit</h2>

              {overview.latestTrip ? (
                <a href="#car-trip-history" aria-label="Laatste rit bekijken">
                  <span>
                    <AppIcon name="car" size={19} />
                  </span>

                  <div>
                    <strong>{formatTripPayers(overview.latestTrip)}</strong>
                    <p>
                      Laatste rit ·{" "}
                      {overview.latestTrip.tripDate
                        .split("-")
                        .reverse()
                        .join("/")}
                    </p>
                  </div>

                  <b>
                    {new Intl.NumberFormat("nl-BE").format(
                      overview.latestTrip.endOdometer -
                        overview.latestTrip.startOdometer,
                    )}{" "}
                    km
                  </b>
                </a>
              ) : null}

              {overview.latestRefuel ? (
                <a
                  href="#car-refuel-history"
                  aria-label="Laatste tankbeurt bekijken"
                >
                  <span>
                    <AppIcon name="wallet" size={19} />
                  </span>

                  <div>
                    <strong>Volle tank</strong>
                    <p>
                      {overview.latestRefuel.tankDate
                        .split("-")
                        .reverse()
                        .join("/")}
                    </p>
                  </div>

                  <b>
                    {new Intl.NumberFormat("nl-BE", {
                      style: "currency",
                      currency: "EUR",
                    }).format(overview.latestRefuel.amountCents / 100)}
                  </b>
                </a>
              ) : null}

              {!overview.latestTrip && !overview.latestRefuel ? (
                <p>Nog geen ritten of tankbeurten geregistreerd.</p>
              ) : null}
            </>
          }
          planning={
            <CarCalendar
              key={id}
              organizationId={id}
              currentUserId={session.user.id}
              isOwner={isOwner}
              today={today}
            />
          }
          costs={
            <>
              {startpoint && overview.settlementOverview ? (
                <CarSettlement
                  organizationId={id}
                  currentUserId={session.user.id}
                  isOwner={isOwner}
                  overview={overview.settlementOverview}
                />
              ) : null}

              <CarStatementHistory
                organizationId={id}
                key={overview.statementHistoryRevision}
              />
            </>
          }
          group={
            <>
              <GroupMembers
                organizationId={id}
                currentUserId={session.user.id}
                members={members}
              />

              {isOwner ? (
                <InvitationLinks
                  organizationId={id}
                  invitations={invitations}
                />
              ) : null}
            </>
          }
        />
      </div>
    </main>
  );
}
