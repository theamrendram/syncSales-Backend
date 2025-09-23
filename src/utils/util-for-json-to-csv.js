const prismaClient = require("../utils/prismaClient");
const { Parser } = require("json2csv");
const fs = require("fs");

async function exportLeadsToCSV() {
  const startDate = new Date("2025-06-01T00:00:00.000Z");
  const endDate = new Date("2025-09-20T23:59:59.999Z");

  try {
    // Fetch data from the database
    const leads = await prismaClient.lead.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        address: true,
        status: true,
        country: true,
        ip: true,
        sub1: true,
        sub2: true,
        sub3: true,
        sub4: true,
        userId: true,
        companyId: true,
        date: true,
        routeId: true,
        campaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (leads.length === 0) {
      console.log("No leads found in the specified date range.");
      return;
    }

    // Convert JSON to CSV
    const parser = new Parser();
    const csv = parser.parse(leads);

    // Write CSV to file
    fs.writeFileSync("leads_jun_to_sep_2025.csv", csv);
    console.log("CSV file saved as leads_jun_to_sep_2025.csv");
  } catch (error) {
    console.error("Error exporting leads:", error);
  } finally {
    await prismaClient.$disconnect();
  }
}

exportLeadsToCSV();
