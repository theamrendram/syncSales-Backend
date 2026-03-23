const prisma = require("../utils/prismaClient");

const resolveActiveOrganization = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[middleware] userId: ", userId);
    let candidateId = req.organizationId || null;
    if (!candidateId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      candidateId = user?.organizationId || null;
      console.log("[middleware] candidateId: ", candidateId);
      
      if (!candidateId) {
        const membership = await prisma.organizationMember.findFirst({
          where: { userId, status: "active" },
          orderBy: { joinedAt: "asc" },
          select: { organizationId: true },
        });
        candidateId = membership?.organizationId || null;
      }
    }

    if (!candidateId) {
      return res.status(400).json({
        error: "No organization context",
        message:
          "User has no organization. Join an organization or pass X-Organization-Id.",
      });
    }

    const org = await prisma.organization.findUnique({
      where: { id: candidateId },
      select: { id: true, ownerId: true },
    });

    console.log("[middleware] org: ", org);

    if (!org) {
      return res.status(400).json({ error: "Invalid organization" });
    }

    if (org.ownerId === userId) {
      console.log("[middleware] org.ownerId === userId");
      req.organizationId = org.id;
      console.log("[middleware] req.organizationId: ", req.organizationId);
      return next();
    }

    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId,
        organizationId: candidateId,
        status: "active",
      },
      include: { role: true },
    });

    if (!membership) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You are not a member of this organization.",
      });
    }

    req.organizationId = membership.organizationId;
    req.organizationMembership = membership;
    return next();
  } catch (error) {
    console.error("resolveActiveOrganization", error);
    return res.status(500).json({
      error: "Failed to resolve organization",
      details: error.message,
    });
  }
};

module.exports = {
  resolveActiveOrganization,
};
