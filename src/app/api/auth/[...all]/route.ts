import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Node.js is the default runtime; cacheComponents disallows a runtime override.

export const { GET, POST } = toNextJsHandler(auth);