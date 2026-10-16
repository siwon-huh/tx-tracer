import { ipAddress, waitUntil } from "@vercel/functions";
import { createApp } from "../server/app.js";

// No listener or Vite middleware in the serverless entry point.
export default createApp({
  backgroundTask: waitUntil,
  clientIp: request => process.env.VERCEL === "1"
    ? ipAddress({ get: name => request.get(name) ?? null })
    : request.ip,
});
