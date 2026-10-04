/**
 * The only place organization membership is written.
 *
 * Membership used to be written from four call sites that each did something
 * slightly different: the REST createOrganization wrote OrganizationMember but
 * not Member, addMember wrote neither Member nor User.organizationId, and only
 * the Better Auth hook wrote all three. The result was that a member added
 * through the API had no organization for API-key purposes at all — their key
 * resolved with organizationId: null and every lead they posted was rejected
 * with "API key must belong to an organization".
 *
 * One helper, so a new call site cannot reintroduce a variant.
 */
import prisma from "../utils/prismaClient.js";
import { DEFAULT_ROLE, isKnownRole } from "./org-roles.js";
import { ensureDefaultRolesForOrganization } from "../utils/default-org-roles.js";
import { syncApiKeyForRole, revokeApiKey } from "./api-keys.js";

/**
 * Adds or updates a membership.
 *
 * `client` takes a transaction when the caller has one, so membership can be
 * created in the same transaction as the organization it belongs to.
 */
export async function upsertMembership({
  client = prisma,
  userId,
  organizationId,
  role = DEFAULT_ROLE,
}) {
  if (!userId || !organizationId) {
    throw new Error("upsertMembership requires userId and organizationId");
  }
  // An unknown role name would store a grant nobody honours: permissionsForRole
  // falls back to the least-privileged role, so the member would silently have
  // less access than whoever added them intended.
  if (!isKnownRole(role)) {
    throw new Error(`Unknown role "${role}"`);
  }

  await ensureDefaultRolesForOrganization(organizationId);

  await client.organizationMember.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    update: { role },
    create: { userId, organizationId, role },
  });

  // User.organizationId is the caller's default organization, and the only
  // organization the API-key path can see — it has no session to carry an active
  // one. Filled when absent, never reassigned: it is single-valued, so
  // overwriting it would silently move an existing member's API key to a
  // different organization.
  await client.user.updateMany({
    where: { id: userId, organizationId: null },
    data: { organizationId },
  });

  // The role decides whether this user holds an API key (owner, admin and
  // publisher do). Done here because this is the one place a role is set, so
  // no call site can grant a role and forget the key that goes with it.
  await syncApiKeyForRole(userId, role, client);
}

export async function removeMembership({
  client = prisma,
  userId,
  organizationId,
}) {
  await client.organizationMember.deleteMany({
    where: { userId, organizationId },
  });

  // A removed member's key would otherwise keep posting leads into an
  // organization they no longer belong to. One organization per user, so with
  // no membership left there is nothing the key is still for.
  const remaining = await client.organizationMember.count({ where: { userId } });
  if (!remaining) {
    await revokeApiKey(userId, client);
  }

  // Leave User.organizationId alone. Clearing it would strip the user's API-key
  // organization even when they still belong elsewhere, and choosing a
  // replacement is a decision this function has no basis to make.
}
