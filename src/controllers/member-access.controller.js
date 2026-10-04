import { z } from "zod";
import prisma from "../utils/prismaClient.js";
import { isKeyRole } from "../lib/org-roles.js";
import { rotateApiKey, revokeApiKey, visibleApiKey } from "../lib/api-keys.js";

/**
 * What an advertiser or publisher may see, and the publisher's API key.
 *
 * Campaign grants are CampaignWebmaster rows and route grants are AccessControl
 * rows — the two tables src/utils/resource-grants.js already reads, so a grant
 * written here narrows every scoped endpoint without further wiring.
 */

const MAX_GRANTS = 500;

const accessSchema = z
  .object({
    campaignIds: z.array(z.string().uuid()).max(MAX_GRANTS),
    routeIds: z.array(z.string().uuid()).max(MAX_GRANTS),
  })
  .strict();

/** The member, provided they belong to the organization in the auth context. */
async function findMember(req, res) {
  const { organizationId, memberId } = req.params;
  if (!req.authContext || req.authContext.organizationId !== organizationId) {
    res
      .status(403)
      .json({ error: "Access denied. You are not a member of this organization." });
    return null;
  }

  const [member, organization] = await Promise.all([
    prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      select: { id: true, userId: true, role: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true },
    }),
  ]);
  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return null;
  }
  return { ...member, organizationId, isOwner: member.userId === organization?.ownerId };
}

const getMemberAccess = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;

    const [campaigns, routes] = await Promise.all([
      prisma.campaignWebmaster.findMany({
        where: { userId: member.userId, campaign: { organizationId: member.organizationId } },
        select: { campaignId: true },
        take: MAX_GRANTS,
      }),
      prisma.accessControl.findMany({
        where: {
          userId: member.userId,
          organizationId: member.organizationId,
          routeId: { not: null },
        },
        select: { routeId: true },
        take: MAX_GRANTS,
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        campaignIds: campaigns.map((c) => c.campaignId),
        routeIds: routes.map((r) => r.routeId),
      },
    });
  } catch (err) {
    req.log.error({ err }, "failed to read member access");
    return res.status(500).json({ error: "Failed to read member access" });
  }
};

/** Replaces the member's campaign and route grants with exactly these. */
const setMemberAccess = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    if (member.isOwner) {
      return res.status(400).json({ error: "The owner always sees everything" });
    }

    const parsed = accessSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "campaignIds and routeIds must be lists of ids" });
    }
    const campaignIds = [...new Set(parsed.data.campaignIds)];
    const routeIds = [...new Set(parsed.data.routeIds)];
    const { organizationId, userId } = member;

    // Every id must belong to this organization. Ids are client-supplied, so
    // without this a grant could reach into another organization's campaign.
    const [campaignCount, routeCount] = await Promise.all([
      prisma.campaign.count({ where: { id: { in: campaignIds }, organizationId } }),
      prisma.route.count({ where: { id: { in: routeIds }, organizationId, deletedAt: null } }),
    ]);
    if (campaignCount !== campaignIds.length || routeCount !== routeIds.length) {
      return res
        .status(400)
        .json({ error: "Some campaigns or routes do not belong to this organization" });
    }

    await prisma.$transaction([
      prisma.campaignWebmaster.deleteMany({
        where: { userId, campaign: { organizationId } },
      }),
      prisma.accessControl.deleteMany({
        where: { userId, organizationId, routeId: { not: null } },
      }),
      prisma.campaignWebmaster.createMany({
        data: campaignIds.map((campaignId) => ({ campaignId, userId })),
      }),
      prisma.accessControl.createMany({
        data: routeIds.map((routeId) => ({
          userId,
          organizationId,
          routeId,
          accessType: "view",
        })),
      }),
    ]);

    req.log.info(
      {
        evt: "member_access_updated",
        organizationId,
        memberId: member.id,
        campaigns: campaignIds.length,
        routes: routeIds.length,
      },
      "member access updated",
    );
    return res.status(200).json({ success: true, data: { campaignIds, routeIds } });
  } catch (err) {
    req.log.error({ err }, "failed to update member access");
    return res.status(500).json({ error: "Failed to update member access" });
  }
};

/**
 * Admins manage keys for members whose role may hold one. The owner's key is
 * the owner's own business: an admin rotating it would break the owner's
 * integrations without the owner having any say.
 */
function refuseKeyChange(req, member) {
  if (!isKeyRole(member.role) && !member.isOwner) {
    return "This member's role can't hold an API key";
  }
  if (member.isOwner && member.userId !== req.authContext.userId) {
    return "Only the owner can change the owner's API key";
  }
  return null;
}

const getMemberApiKey = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    const refusal = refuseKeyChange(req, member);
    if (refusal) return res.status(400).json({ error: refusal });

    const user = await prisma.user.findUnique({
      where: { id: member.userId },
      select: { apiKey: true },
    });
    return res
      .status(200)
      .json({ success: true, data: { apiKey: visibleApiKey(user?.apiKey) } });
  } catch (err) {
    req.log.error({ err }, "failed to read member API key");
    return res.status(500).json({ error: "Failed to read API key" });
  }
};

const rotateMemberApiKey = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    const refusal = refuseKeyChange(req, member);
    if (refusal) return res.status(400).json({ error: refusal });

    const apiKey = await rotateApiKey(member.userId);
    req.log.info(
      { evt: "api_key_rotated", organizationId: member.organizationId, memberId: member.id },
      "member API key rotated",
    );
    return res.status(200).json({ success: true, data: { apiKey } });
  } catch (err) {
    req.log.error({ err }, "failed to rotate member API key");
    return res.status(500).json({ error: "Failed to rotate API key" });
  }
};

const revokeMemberApiKey = async (req, res) => {
  try {
    const member = await findMember(req, res);
    if (!member) return;
    const refusal = refuseKeyChange(req, member);
    if (refusal) return res.status(400).json({ error: refusal });

    await revokeApiKey(member.userId);
    req.log.info(
      { evt: "api_key_revoked", organizationId: member.organizationId, memberId: member.id },
      "member API key revoked",
    );
    return res.status(200).json({ success: true, data: { apiKey: null } });
  } catch (err) {
    req.log.error({ err }, "failed to revoke member API key");
    return res.status(500).json({ error: "Failed to revoke API key" });
  }
};

export {
  getMemberAccess,
  setMemberAccess,
  getMemberApiKey,
  rotateMemberApiKey,
  revokeMemberApiKey,
};
