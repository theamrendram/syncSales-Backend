const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Migration script to set up organizations for existing users
const migrateExistingUsersToOrganizations = async () => {
  try {
    console.log("Starting migration of existing users to organizations...");

    // Get all users who don't have an organization yet
    const users = await prisma.user.findMany({
      where: {
        organizationMemberships: {
          none: {},
        },
      },
    });

    console.log(`Found ${users.length} users without organizations`);

    for (const user of users) {
      try {
        console.log(`Processing user: ${user.email}`);

        // Create organization for user
        const organization = await prisma.organization.create({
          data: {
            name: user.companyName || `${user.firstName}'s Organization`,
            description: `Organization for ${user.firstName} ${user.lastName}`,
            ownerId: user.id,
          },
        });

        console.log(`Created organization: ${organization.name}`);

        // Create default roles
        const defaultRoles = [
          {
            name: "owner",
            description: "Full access to all features",
            permissions: {
              canManageOrganization: true,
              canManageMembers: true,
              canManageRoles: true,
              canViewAllData: true,
              canEditAllData: true,
              canDeleteData: true,
              canManageBilling: true,
            },
          },
          {
            name: "admin",
            description: "Administrative access",
            permissions: {
              canManageOrganization: false,
              canManageMembers: true,
              canManageRoles: false,
              canViewAllData: true,
              canEditAllData: true,
              canDeleteData: true,
              canManageBilling: false,
            },
          },
          {
            name: "manager",
            description: "Manager access",
            permissions: {
              canManageOrganization: false,
              canManageMembers: false,
              canManageRoles: false,
              canViewAllData: true,
              canEditAllData: true,
              canDeleteData: false,
              canManageBilling: false,
            },
          },
          {
            name: "viewer",
            description: "Read-only access",
            permissions: {
              canManageOrganization: false,
              canManageMembers: false,
              canManageRoles: false,
              canViewAllData: true,
              canEditAllData: false,
              canDeleteData: false,
              canManageBilling: false,
            },
          },
        ];

        const roles = await Promise.all(
          defaultRoles.map((role) =>
            prisma.role.create({
              data: {
                ...role,
                organizationId: organization.id,
              },
            })
          )
        );

        console.log(`Created ${roles.length} default roles`);

        // Add user as owner member
        const ownerRole = roles.find((role) => role.name === "owner");
        await prisma.organizationMember.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            roleId: ownerRole.id,
            status: "active",
          },
        });

        console.log(`Added user as owner member`);

        // Add all webmasters as viewer members
        const viewerRole = roles.find((role) => role.name === "viewer");
        const webmasters = await prisma.webmaster.findMany({
          where: { userId: user.id },
        });
        for (const webmaster of webmasters) {
          // Try to find a user with the same email as the webmaster
          const userForWebmaster = await prisma.user.findUnique({
            where: { email: webmaster.email },
          });
          if (!userForWebmaster) {
            // Optionally: create a user for this webmaster, or skip
            continue;
          }
          // Check if already a member
          const existingMember = await prisma.organizationMember.findFirst({
            where: {
              userId: userForWebmaster.id,
              organizationId: organization.id,
            },
          });
          if (!existingMember) {
            await prisma.organizationMember.create({
              data: {
                userId: userForWebmaster.id,
                organizationId: organization.id,
                roleId: viewerRole.id,
                status: "active",
              },
            });
            console.log(`Added webmaster ${webmaster.email} as viewer member`);
          }
        }

        // Migrate existing data to organization
        await Promise.all([
          prisma.lead.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.campaign.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.route.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.webmaster.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.payment.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.subscription.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
          prisma.userPlan.updateMany({
            where: { userId: user.id },
            data: { organizationId: organization.id },
          }),
        ]);

        console.log(`Migrated existing data to organization`);
      } catch (error) {
        console.error(`Error processing user ${user.email}:`, error);
        // Continue with next user
      }
    }

    console.log("Migration completed successfully");
    return { success: true, message: "Migration completed" };
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
};

// Helper function to check migration status
const checkMigrationStatus = async () => {
  try {
    const totalUsers = await prisma.user.count();
    const usersWithOrganizations = await prisma.user.count({
      where: {
        organizationMemberships: {
          some: {},
        },
      },
    });

    const totalOrganizations = await prisma.organization.count();
    const totalRoles = await prisma.role.count();
    const totalMembers = await prisma.organizationMember.count();

    return {
      totalUsers,
      usersWithOrganizations,
      usersWithoutOrganizations: totalUsers - usersWithOrganizations,
      totalOrganizations,
      totalRoles,
      totalMembers,
      migrationProgress: (usersWithOrganizations / totalUsers) * 100,
    };
  } catch (error) {
    console.error("Error checking migration status:", error);
    throw error;
  }
};

// Helper function to rollback migration (for testing)
const rollbackMigration = async () => {
  try {
    console.log("Starting rollback...");

    // Delete all organization-related data
    await Promise.all([
      prisma.organizationMember.deleteMany(),
      prisma.role.deleteMany(),
      prisma.organization.deleteMany(),
    ]);

    // Remove organizationId from all data
    await Promise.all([
      prisma.lead.updateMany({
        data: { organizationId: null },
      }),
      prisma.campaign.updateMany({
        data: { organizationId: null },
      }),
      prisma.route.updateMany({
        data: { organizationId: null },
      }),
      prisma.webmaster.updateMany({
        data: { organizationId: null },
      }),
      prisma.payment.updateMany({
        data: { organizationId: null },
      }),
      prisma.subscription.updateMany({
        data: { organizationId: null },
      }),
      prisma.userPlan.updateMany({
        data: { organizationId: null },
      }),
    ]);

    console.log("Rollback completed");
    return { success: true, message: "Rollback completed" };
  } catch (error) {
    console.error("Rollback failed:", error);
    throw error;
  }
};

// Helper function to validate organization data integrity
const validateOrganizationIntegrity = async () => {
  try {
    const issues = [];

    // Check for orphaned data (data with organizationId but no organization)
    const orphanedLeads = await prisma.lead.count({
      where: {
        organizationId: { not: null },
        organization: null,
      },
    });

    const orphanedCampaigns = await prisma.campaign.count({
      where: {
        organizationId: { not: null },
        organization: null,
      },
    });

    const orphanedRoutes = await prisma.route.count({
      where: {
        organizationId: { not: null },
        organization: null,
      },
    });

    if (orphanedLeads > 0) {
      issues.push(`Found ${orphanedLeads} orphaned leads`);
    }

    if (orphanedCampaigns > 0) {
      issues.push(`Found ${orphanedCampaigns} orphaned campaigns`);
    }

    if (orphanedRoutes > 0) {
      issues.push(`Found ${orphanedRoutes} orphaned routes`);
    }

    // Check for organizations without owners
    const organizationsWithoutOwners = await prisma.organization.findMany({
      where: { ownerId: null },
    });

    if (organizationsWithoutOwners.length > 0) {
      issues.push(
        `Found ${organizationsWithoutOwners.length} organizations without owners`
      );
    }

    // Check for members without valid roles
    const membersWithoutRoles = await prisma.organizationMember.findMany({
      where: {
        role: null,
      },
    });

    if (membersWithoutRoles.length > 0) {
      issues.push(`Found ${membersWithoutRoles.length} members without roles`);
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  } catch (error) {
    console.error("Error validating organization integrity:", error);
    throw error;
  }
};

module.exports = {
  migrateExistingUsersToOrganizations,
  checkMigrationStatus,
  rollbackMigration,
  validateOrganizationIntegrity,
};
