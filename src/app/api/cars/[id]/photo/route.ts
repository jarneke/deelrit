import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readCarPhoto } from "@/lib/github-images";
import { logServerError } from "@/lib/server-error";

type Context = {
    params: Promise<{ id: string }>;
};

const responseHeaders = {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
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
            return new Response("Auto niet gevonden.", {
                status: 404,
                headers: responseHeaders,
            });
        }

        const result = await db.query<{ logo: string | null }>(
            `
        SELECT organization.logo
        FROM public.organization AS organization
        WHERE organization.id = $1
          AND EXISTS (
            SELECT 1
            FROM public.member AS membership
            WHERE membership."organizationId" = organization.id
              AND membership."userId" = $2
          )
        LIMIT 1
      `,
            [id, session.user.id],
        );

        if (result.rowCount !== 1) {
            return new Response("Auto niet gevonden.", {
                status: 404,
                headers: responseHeaders,
            });
        }

        const image = await readCarPhoto(id, result.rows[0].logo);

        return new Response(image, {
            status: 200,
            headers: {
                ...responseHeaders,
                "Content-Type": "image/jpeg",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        logServerError("carPhoto.GET", error);

        return new Response("De autofoto kon niet worden geladen.", {
            status: 503,
            headers: responseHeaders,
        });
    }
}