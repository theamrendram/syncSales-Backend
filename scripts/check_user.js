const prisma = require("../src/utils/prismaClient");

async function check() {
  const rahulEmail = "rahul736283s@gmail.com";
  const sharonEmail = "sharonv@gmail.com";

  console.log(`Checking records for ${rahulEmail}...`);
  const rahulUser = await prisma.user.findUnique({
    where: { email: rahulEmail },
    include: {
      ownedOrganization: true,
      organizationMemberships: {
        include: {
          organization: true,
          role: true,
        },
      },
    },
  });
  console.log("Rahul User:", JSON.stringify(rahulUser, null, 2));

  console.log(`\nChecking records for ${sharonEmail}...`);
  const sharonWebmaster = await prisma.webmaster.findUnique({
    where: { email: sharonEmail },
    include: {
      organization: true,
      user: true,
    },
  });
  console.log("Sharon Webmaster:", JSON.stringify(sharonWebmaster, null, 2));

  const sharonUser = await prisma.user.findUnique({
    where: { email: sharonEmail },
  });
  console.log("Sharon User by Email:", JSON.stringify(sharonUser, null, 2));

  if (sharonWebmaster && sharonWebmaster.apiKey) {
    const sharonUserById = await prisma.user.findUnique({
      where: { id: sharonWebmaster.apiKey },
    });
    console.log(
      "Sharon User by Clerk ID:",
      JSON.stringify(sharonUserById, null, 2),
    );
  }

  const allOrgs = await prisma.organization.findMany({
    include: {
      Role: true,
    },
  });
  console.log(
    "\nAll Organizations and Roles:",
    JSON.stringify(allOrgs, null, 2),
  );

  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
