/**
 * Who holds an API key, and the one place keys are issued or withdrawn.
 *
 * Keys live on `User.apiKey`, which is `@unique @default("0")`: a column every
 * user must fill with a distinct value. A user without a key therefore carries a
 * random placeholder rather than null — unguessable, never shown, and refused by
 * isUsableApiKey() wherever a key is accepted.
 *
 * Only KEY_ROLES (owner, admin, publisher) hold a usable key. Advertisers and
 * managers never send leads, so a live credential on their account would only be
 * one more thing to leak.
 */
import crypto from "crypto";
import prisma from "../utils/prismaClient.js";
import { generateKey } from "../utils/generate-key.js";
import { isKeyRole } from "./org-roles.js";

const NO_KEY_PREFIX = "nokey_";

/** A value for User.apiKey that satisfies the unique index and is never a key. */
export function placeholderApiKey() {
  return `${NO_KEY_PREFIX}${crypto.randomBytes(16).toString("hex")}`;
}

/** True for a real key; false for the column default and for placeholders. */
export function isUsableApiKey(key) {
  return typeof key === "string" && key !== "0" && !key.startsWith(NO_KEY_PREFIX);
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
    data: { apiKey: placeholderApiKey() },
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
