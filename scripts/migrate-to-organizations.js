const {
  migrateExistingUsersToOrganizations,
  checkMigrationStatus,
  validateOrganizationIntegrity,
} = require("../src/utils/migration-helper");

async function runMigration() {
  try {
    console.log("🚀 Starting organization migration...\n");

    // Check current status
    console.log("📊 Checking current migration status...");
    const status = await checkMigrationStatus();
    console.log("Current status:", status);
    console.log("");

    if (status.usersWithoutOrganizations === 0) {
      console.log(
        "✅ All users already have organizations. Migration not needed."
      );
      return;
    }

    // Run migration
    console.log("🔄 Running migration...");
    await migrateExistingUsersToOrganizations();
    console.log("");

    // Check status after migration
    console.log("📊 Checking status after migration...");
    const newStatus = await checkMigrationStatus();
    console.log("New status:", newStatus);
    console.log("");

    // Validate integrity
    console.log("🔍 Validating data integrity...");
    const integrity = await validateOrganizationIntegrity();
    if (integrity.isValid) {
      console.log("✅ Data integrity validation passed");
    } else {
      console.log("❌ Data integrity issues found:");
      integrity.issues.forEach((issue) => console.log(`  - ${issue}`));
    }

    console.log("\n🎉 Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
