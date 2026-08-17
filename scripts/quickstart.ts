/**
 * Step 1 + 2 of the bounty: the published Quickstart and the TenantClient step
 * from Set Up Development Environment, run verbatim.
 *
 *   npx tsx --env-file=.env scripts/quickstart.ts
 */
import { getNodeUrl } from "@terminal3/t3n-sdk";
import { connectTenant, tidOf } from "./session.js";

const { tenantDid, me } = await connectTenant();

console.log("Connected as:  ", tenantDid);
console.log("Node URL:      ", getNodeUrl());
console.log("Tenant id:     ", tidOf(tenantDid));
console.log("TenantClient ready.");
console.log("tenant.tenant.me():", JSON.stringify(me, null, 2));
