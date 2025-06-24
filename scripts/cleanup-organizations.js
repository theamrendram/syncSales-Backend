const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function cleanupOrganizations() {
  try {
    console.log("🧹 Starting organization cleanup...");

    // First, let's see what we have
    const orgCount = await prisma.organization.count();
    const memberCount = await prisma.organizationMember.count();
    const roleCount = await prisma.role.count();

    console.log(`Current data:`);
    console.log(`- Organizations: ${orgCount}`);
    console.log(`- Members: ${memberCount}`);
    console.log(`- Roles: ${roleCount}`);

    if (orgCount === 0) {
      console.log("✅ No organization data to clean up");
      return;
    }

    console.log("🗑️  Deleting all organization-related data...");

    // Delete in the correct order to avoid foreign key constraints
    await Promise.all([
      prisma.organizationMember.deleteMany(),
      prisma.role.deleteMany(),
      prisma.organization.deleteMany(),
    ]);

    console.log("✅ Deleted organization, role, and member data");

    // Reset organizationId fields to null
    console.log("🔄 Resetting organizationId fields...");

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
      prisma.leadUsage.updateMany({
        data: { organizationId: null },
      }),
    ]);

    console.log("✅ Reset all organizationId fields to null");

    // Verify cleanup
    const finalOrgCount = await prisma.organization.count();
    const finalMemberCount = await prisma.organizationMember.count();
    const finalRoleCount = await prisma.role.count();

    console.log(`\n📊 Cleanup verification:`);
    console.log(`- Organizations: ${finalOrgCount} (was ${orgCount})`);
    console.log(`- Members: ${finalMemberCount} (was ${memberCount})`);
    console.log(`- Roles: ${finalRoleCount} (was ${roleCount})`);

    if (finalOrgCount === 0 && finalMemberCount === 0 && finalRoleCount === 0) {
      console.log("🎉 Cleanup completed successfully!");
      console.log("✅ You can now run the migration script again");
    } else {
      console.log("❌ Cleanup may not have completed fully");
    }
  } catch (error) {
    console.error("❌ Cleanup failed:", error);
    throw error;
  }
}

// Run the cleanup
if (require.main === module) {
  cleanupOrganizations()
    .then(() => {
      console.log("✅ Cleanup completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Cleanup failed:", error);
      process.exit(1);
    });
}

module.exports = { cleanupOrganizations };
