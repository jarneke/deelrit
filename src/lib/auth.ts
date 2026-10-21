import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { Pool } from "pg";
import { logServerError } from "@/lib/server-error";

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
        resetPasswordTokenExpiresIn: 30 * 60,
        revokeSessionsOnPasswordReset: true,

        async sendResetPassword({ user, url }) {
            try {
                const gmailUser = process.env.GMAIL_USER?.trim();
                const gmailAppPassword =
                    process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

                if (!gmailUser || !gmailAppPassword) {
                    throw new Error(
                        "De configuratie voor resetmails ontbreekt.",
                    );
                }

                const transporter = nodemailer.createTransport({
                    service: "gmail",
                    auth: {
                        user: gmailUser,
                        pass: gmailAppPassword,
                    },
                    connectionTimeout: 10000,
                    greetingTimeout: 10000,
                    socketTimeout: 20000,
                });

                await transporter.sendMail({
                    from: {
                        name: "Deelrit",
                        address: gmailUser,
                    },
                    to: user.email,
                    subject: "Stel je Deelrit-wachtwoord opnieuw in",
                    text: [
                        "Je hebt gevraagd om je Deelrit-wachtwoord opnieuw in te stellen.",
                        "",
                        "Open deze link om een nieuw wachtwoord te kiezen:",
                        url,
                        "",
                        "Deze link is 30 minuten geldig.",
                        "",
                        "Heb je dit niet aangevraagd? Dan hoef je niets te doen.",
                        "Je wachtwoord blijft ongewijzigd.",
                    ].join("\n"),
                });
            } catch (error) {
                logServerError("auth.sendResetPassword", error);

                throw new Error(
                    "De resetmail kon niet worden verstuurd.",
                );
            }
        },
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