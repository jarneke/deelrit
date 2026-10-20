import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { Pool } from "pg";

export const auth = betterAuth({
    appName: "Deelrit",

    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,

    database: new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
    }),

    emailAndPassword: {
        enabled: true,
        minPasswordLength: 12,
    },

    plugins: [
        organization({
            allowUserToCreateOrganization: true,

            schema: {
                organization: {
                    additionalFields: {
                        licensePlate: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                    },
                },
            },
        }),

        nextCookies(),
    ],
});