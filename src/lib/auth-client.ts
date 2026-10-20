"use client";

import { createAuthClient } from "better-auth/react";
import {
    inferOrgAdditionalFields,
    organizationClient,
} from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";

export const authClient = createAuthClient({
    plugins: [
        organizationClient({
            schema: inferOrgAdditionalFields<typeof auth>(),
        }),
    ],
});