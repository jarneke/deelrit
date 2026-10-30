import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readProfilePhoto } from "@/lib/github-images";
import { logServerError } from "@/lib/server-error";

type Context = {
    params: Promise<{ id: string }>;
};

const responseHeaders = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
};

export async function GET(
    _request: Request,
    { params }: Context,
): Promise<Response> {
    try {
        const session = await getSession();

        if (!session) {
            return new Response("Log eerst in.", {
                status: 401,
                headers: responseHeaders,
            });
        }

        const { id } = await params;

        if (!id || id.length > 128) {
            return new Response("Foto niet gevonden.", {
                status: 404,
                headers: responseHeaders,
            });
        }

        const result = await db.query<{ image: string | null }>(
            `
        SELECT person.image
        FROM public."user" AS person
        WHERE person.id = $1
          AND (
            person.id = $2
            OR EXISTS (
              SELECT 1
              FROM public.member AS target
              JOIN public.member AS viewer
                ON viewer."organizationId" = target."organizationId"
              WHERE target."userId" = person.id
                AND viewer."userId" = $2
            )
          )
        LIMIT 1
      `,
            [id, session.user.id],
        );

        if (result.rowCount !== 1) {
            return new Response("Foto niet gevonden.", {
                status: 404,
                headers: responseHeaders,
            });
        }

        const image = await readProfilePhoto(id, result.rows[0].image);

        if (!image) {
            return new Response("Foto niet gevonden.", {
                status: 404,
                headers: responseHeaders,
            });
        }

        return new Response(image, {
            status: 200,
            headers: {
                ...responseHeaders,
                "Content-Type": "image/jpeg",
            },
        });
    } catch (error) {
        logServerError("profilePhoto.GET", error);

        return new Response("De profielfoto kon niet worden geladen.", {
            status: 503,
            headers: responseHeaders,
        });
    }
}