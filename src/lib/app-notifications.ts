import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { deliverPush, pushStatusCode } from "@/lib/push";
import { logServerError } from "@/lib/server-error";

type Data = Record<string, unknown>;

type Change = {
    id: string;
    organization_id: string;
    organization_name: string;
    actor_id: string;
    actor_name: string;
    source_table: string;
    operation: "INSERT" | "UPDATE" | "DELETE";
    before_row: Data | null;
    after_row: Data | null;
    trip_snapshot: Data[] | null;
    start_odometer: number | null;
};

type Member = {
    organization_id: string;
    user_id: string;
    name: string;
    role: string;
};

type Plan = {
    user_id: string;
    organization_id: string;
    title: string;
    body: string;
    url: string;
    allow_former_member: boolean;
};

type Target = {
    plan_index: number;
    endpoint_hash: string;
    session_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
};

function text(row: Data | null, field: string): string {
    const value = row?.[field];
    return typeof value === "string" ? value : "";
}

function number(row: Data | null, field: string): number {
    const value = row?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function owner(role: string): boolean {
    return role.split(",").some((part) => part.trim() === "owner");
}

function when(value: string): string {
    const stamp = new Date(value);

    if (!Number.isFinite(stamp.getTime())) {
        return "het gekozen tijdstip";
    }

    return new Intl.DateTimeFormat("nl-BE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Brussels",
    }).format(stamp);
}

function different(
    before: Data | null,
    after: Data | null,
    fields: string[],
) {
    return fields.some((field) => before?.[field] !== after?.[field]);
}

function gaps(rows: Data[], start: number): Array<[number, number]> {
    const result: Array<[number, number]> = [];
    let end = start;

    for (const row of [...rows].sort(
        (left, right) =>
            number(left, "start_odometer") - number(right, "start_odometer"),
    )) {
        const next = number(row, "start_odometer");

        if (next > end) {
            result.push([end, next]);
        }

        end = Math.max(end, number(row, "end_odometer"));
    }

    return result;
}

function additionalMissing(
    before: Array<[number, number]>,
    after: Array<[number, number]>,
): number {
    return after.reduce((total, [start, end]) => {
        const alreadyMissing = before.reduce(
            (sum, [oldStart, oldEnd]) =>
                sum +
                Math.max(
                    0,
                    Math.min(end, oldEnd) - Math.max(start, oldStart),
                ),
            0,
        );

        return total + Math.max(0, end - start - alreadyMissing);
    }, 0);
}

function buildPlans(changes: Change[], members: Member[]): Plan[] {
    const plans = new Map<string, Plan>();

    function add(
        change: Change,
        kind: string,
        entity: string,
        userId: string,
        title: string,
        body: string,
        allowFormerMember = false,
    ) {
        if (!userId || userId === change.actor_id) {
            return;
        }

        if (
            !allowFormerMember &&
            !members.some(
                (member) =>
                    member.organization_id === change.organization_id &&
                    member.user_id === userId,
            )
        ) {
            return;
        }

        const key = JSON.stringify([
            kind,
            change.organization_id,
            entity,
            userId,
        ]);

        plans.set(key, {
            user_id: userId,
            organization_id: change.organization_id,
            title,
            body: body.slice(0, 500),
            url: allowFormerMember
                ? "/account"
                : "/auto/" + encodeURIComponent(change.organization_id),
            allow_former_member: allowFormerMember,
        });
    }

    function group(change: Change) {
        return members.filter(
            (member) => member.organization_id === change.organization_id,
        );
    }

    function groupMessage(
        change: Change,
        kind: string,
        title: string,
        body: string,
    ) {
        for (const member of group(change)) {
            add(change, kind, "", member.user_id, title, body);
        }
    }

    for (const change of changes) {
        const before = change.before_row;
        const after = change.after_row;
        const row = after ?? before;
        const entity = text(row, "id");
        const car = change.organization_name.slice(0, 120);
        const actor = change.actor_name.slice(0, 80);

        if (change.source_table === "car_reservation") {
            if (change.operation === "INSERT") {
                for (const member of group(change)) {
                    add(
                        change,
                        "reservation-new",
                        entity,
                        member.user_id,
                        "Nieuwe reservatie",
                        actor +
                        " reserveerde " +
                        car +
                        " van " +
                        when(text(after, "starts_at")) +
                        " tot " +
                        when(text(after, "ends_at")) +
                        ".",
                    );
                }
            } else if (
                change.operation === "UPDATE" &&
                before?.cancelled_at == null &&
                after?.cancelled_at != null
            ) {
                add(
                    change,
                    "reservation-cancelled",
                    entity,
                    text(before, "reserved_by"),
                    "Je reservatie is geannuleerd",
                    actor +
                    " annuleerde je reservatie van " +
                    car +
                    " op " +
                    when(text(before, "starts_at")) +
                    ".",
                );
            } else if (
                change.operation === "UPDATE" &&
                after?.cancelled_at == null &&
                different(before, after, [
                    "starts_at",
                    "ends_at",
                    "description",
                ])
            ) {
                add(
                    change,
                    "reservation-changed",
                    entity,
                    text(before, "reserved_by"),
                    "Je reservatie is gewijzigd",
                    actor +
                    " wijzigde je reservatie van " +
                    car +
                    ". De reservatie loopt van " +
                    when(text(after, "starts_at")) +
                    " tot " +
                    when(text(after, "ends_at")) +
                    ".",
                );
            }
        }

        if (change.source_table === "car_refuel") {
            const amount = new Intl.NumberFormat("nl-BE", {
                style: "currency",
                currency: "EUR",
            }).format(number(row, "amount_cents") / 100);

            if (change.operation === "INSERT") {
                add(
                    change,
                    "refuel-added",
                    entity,
                    text(after, "paid_by"),
                    "Tankbeurt op jouw naam",
                    actor +
                    " registreerde voor " +
                    car +
                    " een tankbeurt van " +
                    amount +
                    " met jou als betaler.",
                );
            } else if (change.operation === "DELETE") {
                add(
                    change,
                    "refuel-deleted",
                    entity,
                    text(before, "paid_by"),
                    "Je tankbeurt is verwijderd",
                    actor +
                    " verwijderde je tankbeurt van " +
                    amount +
                    " voor " +
                    car +
                    ".",
                );
            } else {
                if (
                    before?.settled_at != null &&
                    after?.settled_at == null
                ) {
                    groupMessage(
                        change,
                        "settlement-reopened",
                        "Tankperiode opnieuw geopend",
                        actor +
                        " opende een afgerekende tankperiode van " +
                        car +
                        " opnieuw. Bekijk de open afrekening.",
                    );
                }

                if (
                    different(before, after, [
                        "paid_by",
                        "tank_date",
                        "odometer",
                        "amount_cents",
                    ])
                ) {
                    const oldPayer = text(before, "paid_by");
                    const newPayer = text(after, "paid_by");

                    add(
                        change,
                        "refuel-changed",
                        entity,
                        oldPayer,
                        "Je tankbeurt is gewijzigd",
                        actor +
                        " wijzigde een tankbeurt voor " +
                        car +
                        (oldPayer === newPayer
                            ? ". Het geregistreerde bedrag is " + amount + "."
                            : ". Jij staat niet meer als betaler vermeld."),
                    );

                    if (newPayer !== oldPayer) {
                        add(
                            change,
                            "refuel-changed",
                            entity,
                            newPayer,
                            "Tankbeurt op jouw naam",
                            actor +
                            " duidde jou aan als betaler van een tankbeurt van " +
                            amount +
                            " voor " +
                            car +
                            ".",
                        );
                    }
                }
            }
        }

        if (change.source_table === "car_statement_history") {
            if (change.operation === "INSERT") {
                groupMessage(
                    change,
                    "settlement-closed",
                    "Afrekening afgesloten",
                    actor +
                    " markeerde een afrekening van " +
                    car +
                    " als afbetaald.",
                );
            } else if (
                before?.reopened_at == null &&
                after?.reopened_at != null
            ) {
                groupMessage(
                    change,
                    "settlement-reopened",
                    "Tankperiode opnieuw geopend",
                    actor +
                    " opende een afgerekende tankperiode van " +
                    car +
                    " opnieuw. Bekijk de open afrekening.",
                );
            }
        }

        if (change.source_table === "member") {
            const userId = text(row, "userId");

            if (change.operation === "INSERT") {
                const name =
                    group(change).find((member) => member.user_id === userId)
                        ?.name ?? "Een nieuw lid";

                for (const member of group(change).filter((item) =>
                    owner(item.role),
                )) {
                    add(
                        change,
                        "member-joined",
                        userId,
                        member.user_id,
                        "Nieuw groepslid",
                        name +
                        " is toegetreden tot de groep van " +
                        car +
                        ".",
                    );
                }
            } else if (change.operation === "DELETE") {
                add(
                    change,
                    "member-removed",
                    userId,
                    userId,
                    "Je toegang is gewijzigd",
                    actor +
                    " verwijderde je uit de groep van " +
                    car +
                    ".",
                    true,
                );
            } else if (different(before, after, ["role"])) {
                const role = text(after, "role");
                const label = owner(role)
                    ? "eigenaar"
                    : role.split(",").some((part) => part.trim() === "admin")
                        ? "beheerder"
                        : "lid";

                add(
                    change,
                    "member-role",
                    userId,
                    userId,
                    "Je rol is gewijzigd",
                    actor +
                    " wijzigde je rol bij " +
                    car +
                    " naar " +
                    label +
                    ".",
                );
            }
        }

        if (
            change.source_table === "car_invitation_link" &&
            before?.used_at == null &&
            after?.used_at != null
        ) {
            add(
                change,
                "member-joined",
                text(after, "used_by"),
                text(after, "created_by"),
                "Uitnodiging aanvaard",
                actor +
                " aanvaardde je uitnodiging voor " +
                car +
                ".",
            );
        }
    }

    const tripChanges = changes.filter(
        (change) => change.source_table === "car_trip",
    );

    for (const change of tripChanges) {
        const before = change.before_row;
        const after = change.after_row;
        const id = text(after ?? before, "id");

        const payerChanges = changes.filter(
            (item) =>
                item.source_table === "car_trip_payer" &&
                text(item.after_row ?? item.before_row, "trip_id") === id,
        );

        const oldRows = payerChanges
            .filter((item) => item.operation === "DELETE")
            .map((item) => item.before_row!);

        const newRows = payerChanges
            .filter((item) => item.operation === "INSERT")
            .map((item) => item.after_row!);

        const oldUsers = new Set(
            oldRows.length > 0
                ? oldRows
                    .map((item) => text(item, "user_id"))
                    .filter(Boolean)
                : before
                    ? [text(before, "driver_id")]
                    : [],
        );

        const newUsers = new Set(
            newRows.length > 0
                ? newRows
                    .map((item) => text(item, "user_id"))
                    .filter(Boolean)
                : after
                    ? [text(after, "driver_id")]
                    : [],
        );

        const oldCount = before ? oldRows.length || 1 : 0;
        const newCount = after ? newRows.length || 1 : 0;
        const oldDistance =
            number(before, "end_odometer") - number(before, "start_odometer");
        const newDistance =
            number(after, "end_odometer") - number(after, "start_odometer");
        const distanceChanged = oldDistance !== newDistance;
        const countChanged = oldCount !== newCount;
        const odometerChanged = different(before, after, [
            "start_odometer",
            "end_odometer",
        ]);
        const timeChanged = different(before, after, [
            "trip_date",
            "ended_at",
        ]);
        const shareChanged = countChanged || odometerChanged || timeChanged;
        const formatDistance = (value: number) =>
            new Intl.NumberFormat("nl-BE").format(value) + " km";

        for (const userId of new Set([...oldUsers, ...newUsers])) {
            let title = "";
            let body = "";
            const car = change.organization_name.slice(0, 120);
            const actor = change.actor_name.slice(0, 80);

            if (!after) {
                title = oldCount === 1
                    ? "Je rit is verwijderd"
                    : "Gedeelde rit verwijderd";
                body = actor + " verwijderde een rit van " +
                    formatDistance(oldDistance) + " met " + car +
                    (oldCount === 1
                        ? " die op jouw naam stond."
                        : " die je mee betaalde.");
            } else if (!newUsers.has(userId)) {
                title = oldCount === 1
                    ? "Rit staat niet meer op jouw naam"
                    : "Je betaalt niet meer mee aan deze rit";
                body = actor + " haalde je uit de betalers van een rit van " +
                    formatDistance(newDistance) + " met " + car + ".";
            } else if (!oldUsers.has(userId)) {
                if (newCount === 1) {
                    title = before
                        ? "Rit op jouw naam gezet"
                        : "Rit voor jou geregistreerd";
                    body = before
                        ? actor + " zette een bestaande rit van " +
                        formatDistance(newDistance) + " met " + car +
                        " op jouw naam."
                        : actor + " registreerde een rit van " +
                        formatDistance(newDistance) + " met " + car +
                        " op jouw naam.";
                } else if (before) {
                    title = "Toegevoegd als medebetaler";
                    body = actor + " voegde je toe als medebetaler van een " +
                        "bestaande rit van " + formatDistance(newDistance) +
                        " met " + car + ". Er zijn nu " +
                        newCount + " betalers in totaal.";
                } else {
                    title = "Je deelt de kosten van een rit";

                    if (newUsers.has(change.actor_id) && newCount === 2) {
                        body = actor + " registreerde een rit van " +
                            formatDistance(newDistance) + " met " + car +
                            " die jullie samen betalen.";
                    } else {
                        const others = newCount - 1;
                        body = actor + " registreerde een rit van " +
                            formatDistance(newDistance) + " met " + car +
                            " die je samen met " + others +
                            (others === 1 ? " andere betaler" : " andere betalers") +
                            " betaalt.";
                    }
                }
            } else if (shareChanged) {
                const details: string[] = [];

                if (distanceChanged) {
                    details.push(
                        "De afstand veranderde van " +
                        formatDistance(oldDistance) + " naar " +
                        formatDistance(newDistance) + ".",
                    );
                } else if (odometerChanged) {
                    details.push("De kilometerstanden zijn aangepast.");
                }

                if (countChanged) {
                    details.push(
                        newCount === 1
                            ? "Je bent nu de enige betaler van deze rit."
                            : "Je deelt deze rit nu met " + newCount +
                            " betalers in totaal, inclusief jezelf.",
                    );
                }

                if (timeChanged) {
                    const endedAt = text(after, "ended_at");
                    const date = text(after, "trip_date");
                    const parsedDate = new Date(date + "T00:00:00Z");

                    if (endedAt) {
                        details.push(
                            "Het geregistreerde eindtijdstip is nu " +
                            when(endedAt) + ".",
                        );
                    } else if (Number.isFinite(parsedDate.getTime())) {
                        details.push(
                            "De ritdatum is nu " +
                            new Intl.DateTimeFormat("nl-BE", {
                                dateStyle: "medium",
                                timeZone: "UTC",
                            }).format(parsedDate) + ".",
                        );
                    } else {
                        details.push("Het tijdstip van de rit is aangepast.");
                    }
                }

                title = distanceChanged && countChanged
                    ? "Rit en verdeling gewijzigd"
                    : distanceChanged
                        ? "Afstand van je rit gewijzigd"
                        : countChanged
                            ? "Betalers van je rit gewijzigd"
                            : timeChanged
                                ? "Tijdstip van je rit gewijzigd"
                                : "Kilometerstanden van je rit gewijzigd";
                body = actor + " wijzigde een rit met " + car +
                    ". " + details.join(" ");
            }

            if (title) {
                add(change, "trip", id, userId, title, body);
            }
        }
    }

    const organizations = [
        ...new Set(
            tripChanges.map((change) => change.organization_id),
        ),
    ];

    for (const organizationId of organizations) {
        const related = tripChanges.filter(
            (change) => change.organization_id === organizationId,
        );

        const first = related[0];
        const last = related[related.length - 1];

        if (
            first.start_odometer === null ||
            !first.trip_snapshot ||
            !last.trip_snapshot
        ) {
            continue;
        }

        const before = first.trip_snapshot.filter(
            (trip) => text(trip, "id") !== text(first.after_row, "id"),
        );

        if (first.before_row) {
            before.push(first.before_row);
        }

        const missing = additionalMissing(
            gaps(before, first.start_odometer),
            gaps(last.trip_snapshot, first.start_odometer),
        );

        if (missing > 0) {
            for (const member of group(last).filter((item) =>
                owner(item.role),
            )) {
                add(
                    last,
                    "kilometers",
                    "",
                    member.user_id,
                    "Ontbrekende kilometers",
                    "Bij " +
                    last.organization_name.slice(0, 120) +
                    " ontbreken " +
                    new Intl.NumberFormat("nl-BE").format(missing) +
                    " bijkomende km tussen de registraties. Bekijk de ritten.",
                );
            }
        }
    }

    return [...plans.values()];
}

export async function sendAppNotifications(
    batchId: string,
): Promise<void> {
    const result = await db.query<Change>(
        `
      WITH claimed AS (
        UPDATE public.app_notification_change
        SET processed_at = clock_timestamp()
        WHERE batch_id = $1
          AND processed_at IS NULL
        RETURNING *
      )
      SELECT *
      FROM claimed
      ORDER BY id
    `,
        [batchId],
    );

    if (result.rows.length === 0) {
        return;
    }

    const members = await db.query<Member>(
        `
      SELECT
        membership."organizationId" AS organization_id,
        membership."userId" AS user_id,
        person.name,
        membership.role
      FROM public.member AS membership
      JOIN public."user" AS person
        ON person.id = membership."userId"
      WHERE membership."organizationId" = ANY($1::text[])
    `,
        [
            [
                ...new Set(
                    result.rows.map((row) => row.organization_id),
                ),
            ],
        ],
    );

    const plans = buildPlans(result.rows, members.rows);

    if (plans.length > 0) {
        const targets = await db.query<Target>(
            `
        SELECT
          plan.plan_index,
          subscription.endpoint_hash,
          subscription.session_id,
          subscription.endpoint,
          subscription.p256dh,
          subscription.auth
        FROM jsonb_to_recordset($1::jsonb) AS plan(
          plan_index integer,
          user_id text,
          organization_id text,
          allow_former_member boolean
        )
        JOIN public.session AS login
          ON login."userId" = plan.user_id
        JOIN public.push_subscription AS subscription
          ON subscription.session_id = login.id
        WHERE login."expiresAt" > clock_timestamp()
          AND (
            plan.allow_former_member
            OR EXISTS (
              SELECT 1
              FROM public.member AS membership
              WHERE membership."organizationId"
                = plan.organization_id
                AND membership."userId" = plan.user_id
            )
          )
      `,
            [
                JSON.stringify(
                    plans.map((plan, index) => ({
                        plan_index: index,
                        user_id: plan.user_id,
                        organization_id: plan.organization_id,
                        allow_former_member: plan.allow_former_member,
                    })),
                ),
            ],
        );

        for (
            let offset = 0;
            offset < targets.rows.length;
            offset += 4
        ) {
            const outcomes = await Promise.allSettled(
                targets.rows
                    .slice(offset, offset + 4)
                    .map(async (target) => {
                        const plan = plans[target.plan_index];

                        const tag = createHash("sha256")
                            .update(batchId + ":" + target.plan_index)
                            .digest("hex");

                        try {
                            await deliverPush(
                                {
                                    endpoint: target.endpoint,
                                    keys: {
                                        p256dh: target.p256dh,
                                        auth: target.auth,
                                    },
                                },
                                {
                                    title: plan.title,
                                    body: plan.body,
                                    url: plan.url,
                                    tag: "deelrit-" + tag,
                                },
                                { ttlSeconds: 3600 },
                            );
                        } catch (error) {
                            const status = pushStatusCode(error);

                            if (status === 404 || status === 410) {
                                await db.query(
                                    `
                    DELETE FROM public.push_subscription
                    WHERE endpoint_hash = $1
                      AND session_id = $2
                      AND p256dh = $3
                      AND auth = $4
                  `,
                                    [
                                        target.endpoint_hash,
                                        target.session_id,
                                        target.p256dh,
                                        target.auth,
                                    ],
                                );
                            } else {
                                throw error;
                            }
                        }
                    }),
            );

            for (const outcome of outcomes) {
                if (outcome.status === "rejected") {
                    logServerError(
                        "notifications.delivery",
                        outcome.reason,
                    );
                }
            }
        }
    }

    await db.query(
        `
      DELETE FROM public.app_notification_change
      WHERE batch_id = $1
        OR created_at
          < clock_timestamp() - INTERVAL '7 days'
    `,
        [batchId],
    );
}