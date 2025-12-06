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
        organizationId: true,
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

// exportLeadsToCSV();

async function downloadLeadsForSpecificDays(dateStr, userId = null) {
  // dateStr format: 'YYYY-MM-DD'
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  const endDate = new Date(`${dateStr}T23:59:59.999Z`);

  try {
    console.log(`Fetching leads for date: ${dateStr}${userId ? ` and User: ${userId}` : ''}`);
    
    const where = {
      date: {
        gte: startDate,
        lte: endDate,
      },
    };
    
    if (userId) {
      where.userId = userId;
    }

    // Fetch data from the database
    const leads = await prismaClient.lead.findMany({
      where,
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
        organizationId: true,
        date: true,
        routeId: true,
        campaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (leads.length === 0) {
      console.log(`No leads found for date ${dateStr}.`);
      return;
    }

    // Convert JSON to CSV
    const parser = new Parser();
    const csv = parser.parse(leads);

    // Write CSV to file
    const safeUserId = userId ? `_${userId}` : '';
    const fileName = `leads_${dateStr}${safeUserId}.csv`;
    fs.writeFileSync(fileName, csv);
    console.log(`CSV file saved as ${fileName}`);
  } catch (error) {
    console.error("Error exporting leads:", error);
  } finally {
    // Only disconnect if this is the last operation
    await prismaClient.$disconnect();
  }
}

// Example usage:
// downloadLeadsForSpecificDays('2025-12-05');

async function downloadLeadsForSpecificDateNoDuplicates(dateStr, userId = null) {
  // dateStr format: 'YYYY-MM-DD'
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  const endDate = new Date(`${dateStr}T23:59:59.999Z`);

  try {
    console.log(`Fetching non-duplicate leads for date: ${dateStr}${userId ? ` and User: ${userId}` : ''}`);
    
    const where = {
      date: {
        gte: startDate,
        lte: endDate,
      },
      NOT: {
        status: {
          in: ["Duplicate", "duplicate"],
        },
      },
    };

    if (userId) {
      where.userId = userId;
    }

    // Fetch data from the database
    const leads = await prismaClient.lead.findMany({
      where,
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
        organizationId: true,
        date: true,
        routeId: true,
        campaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (leads.length === 0) {
      console.log(`No non-duplicate leads found for date ${dateStr}.`);
      return;
    }
    console.log(`Found ${leads.length} non-duplicate leads for date ${dateStr}.`);

    // Convert JSON to CSV
    const parser = new Parser();
    const csv = parser.parse(leads);

    // Write CSV to file
    const safeUserId = userId ? `_${userId}` : '';
    const fileName = `leads_no_dupes_${dateStr}${safeUserId}.csv`;
    fs.writeFileSync(fileName, csv);
    console.log(`CSV file saved as ${fileName}`);
  } catch (error) {
    console.error("Error exporting leads:", error);
  } finally {
    // Only disconnect if this is the last operation
    await prismaClient.$disconnect();
  }
}

// Example usage:
// downloadLeadsForSpecificDateNoDuplicates('2025-12-05');

async function downloadLeadsForSpecificDateNoDuplicatesInIST(dateStr, userId = null) {
  // dateStr format: 'YYYY-MM-DD'
  // Create dates pretending they are IST (+05:30)
  // 00:00:00 IST = previous day 18:30:00 UTC
  // 23:59:59 IST = current day 18:29:59 UTC
  
  const startDate = new Date(`${dateStr}T00:00:00+05:30`);
  const endDate = new Date(`${dateStr}T23:59:59.999+05:30`);

  try {
    console.log(`Fetching non-duplicate leads for date (IST): ${dateStr}${userId ? ` and User: ${userId}` : ''}`);
    console.log(`Querying range (UTC): ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const where = {
      date: {
        gte: startDate,
        lte: endDate,
      },
      NOT: {
        status: {
          in: ["Duplicate", "duplicate"],
        },
      },
    };

    if (userId) {
      where.userId = userId;
    }

    // Fetch data from the database
    const leads = await prismaClient.lead.findMany({
      where,
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
        organizationId: true,
        date: true,
        routeId: true,
        campaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (leads.length === 0) {
      console.log(`No non-duplicate leads found for date ${dateStr} (IST).`);
      return;
    }
    console.log(`Found ${leads.length} non-duplicate leads for date ${dateStr} (IST).`);

    // Convert JSON to CSV
    const parser = new Parser();
    const csv = parser.parse(leads);

    // Write CSV to file
    const safeUserId = userId ? `_${userId}` : '';
    const fileName = `leads_no_dupes_IST_${dateStr}${safeUserId}.csv`;
    fs.writeFileSync(fileName, csv);
    console.log(`CSV file saved as ${fileName}`);
  } catch (error) {
    console.error("Error exporting leads:", error);
  } finally {
    // Only disconnect if this is the last operation
    await prismaClient.$disconnect();
  }
}

// Example usage:
downloadLeadsForSpecificDateNoDuplicatesInIST('2025-12-05', 'user_2wUpcMa080qc5635eeuSTOgoQUR');
