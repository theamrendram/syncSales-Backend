/**
 * Who holds an API key, and the one place keys are issued or withdrawn.
 *
 * Keys live on `User.apiKey`, which is nullable and `@unique`: NULL means no
 * key, and any number of users may hold NULL without colliding on the index.
 *
 * Only KEY_ROLES (owner, advertiser, publisher) hold a key. Admins and managers
 * work in the dashboard, so a live credential on their account would only be
 * one more thing to leak.
 */
import prisma from "../utils/prismaClient.js";
import { generateKey } from "../utils/generate-key.js";
import { isKeyRole } from "./org-roles.js";

/**
 * True for a real key. Rows written before keys became nullable may still hold
 * the old column default "0" or a "nokey_" placeholder; neither is a key.
 */
export function isUsableApiKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key !== "0" &&
    !key.startsWith("nokey_")
  );
}

/** The key as the UI should see it: the key itself, or null when there is none. */
export function visibleApiKey(key) {
  return isUsableApiKey(key) ? key : null;
}

/** Issues a fresh key, replacing any existing one. Returns the new key. */
export async function rotateApiKey(userId, client = prisma) {
  const apiKey = generateKey();
  await client.user.update({ where: { id: userId }, data: { apiKey } });
  return apiKey;
}

/** Withdraws the user's key. Anything still sending with it starts failing. */
export async function revokeApiKey(userId, client = prisma) {
  await client.user.update({
    where: { id: userId },
    data: { apiKey: null },
  });
}

/**
 * Brings a user's key in line with a role they were just given: issued when the
 * role may hold one and they have none, withdrawn when it may not. An existing
 * usable key is kept, so a role change between key roles does not break a live
 * integration.
 */
export async function syncApiKeyForRole(userId, role, client = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { apiKey: true },
  });
  if (!user) return;

  const usable = isUsableApiKey(user.apiKey);
  if (isKeyRole(role) && !usable) {
    await rotateApiKey(userId, client);
  } else if (!isKeyRole(role) && usable) {
    await revokeApiKey(userId, client);
  }
}
