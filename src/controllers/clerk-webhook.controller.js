const prisma = require("../utils/prismaClient");
const { Webhook } = require("svix");

// Handle Clerk webhook events
const handleClerkWebhook = async (req, res) => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    console.log("WEBHOOK_SECRET", WEBHOOK_SECRET);

    if (!WEBHOOK_SECRET) {
      console.error("Missing CLERK_WEBHOOK_SECRET environment variable");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    // Clerk sends these headers for verification
    const svix_id = req.headers["svix-id"];
    const svix_timestamp = req.headers["svix-timestamp"];
    const svix_signature = req.headers["svix-signature"];

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return res.status(400).json({ error: "Missing svix headers" });
    }

    // Create webhook verifier
    const wh = new Webhook(WEBHOOK_SECRET);

    let evt;
    try {
      evt = wh.verify(req.body.toString(), {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      console.error(" Webhook signature verification failed:", err);
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Extract event
    const { type, data } = evt;
    console.log("✅ Webhook received:", type, "data:", data);

    switch (type) {
      case "user.created":
        await handleUserCreated(data);
        break;
      case "user.updated":
        await handleUserUpdated(data);
        break;
      case "user.deleted":
        await handleUserDeleted(data);
        break;
      default:
        console.log(`⚠️ Unhandled webhook event type: ${type}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Handle user creation
async function handleUserCreated(data) {
  console.log("handleUserCreated", data);
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      console.error("No email found in user data");
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log(`User with email ${email} already exists`);
      return;
    }

    // Create user in database
    const user = await prisma.user.create({
      data: {
        id: data.id,
        email,
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        role: "admin", // Default role as per schema
        apiKey: Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15),
      },
    });

    console.log(`User created successfully: ${user.email}`);
  } catch (error) {
    console.error("Error creating user from webhook:", error);
  }
}

// Handle user updates
async function handleUserUpdated(data) {
  console.log("handleUserUpdated", data);
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      console.error("No email found in user data");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log(`User with email ${email} not found for update`);
      return;
    }

    // Update user in database
    await prisma.user.update({
      where: { email },
      data: {
        firstName: data.first_name || user.firstName,
        lastName: data.last_name || user.lastName,
      },
    });

    console.log(`User updated successfully: ${email}`);
  } catch (error) {
    console.error("Error updating user from webhook:", error);
  }
}

// Handle user deletion
async function handleUserDeleted(data) {
  console.log("handleUserDeleted", data);
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      console.error("No email found in user data");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log(`User with email ${email} not found for deletion`);
      return;
    }

    // Delete user from database
    await prisma.user.delete({
      where: { email },
    });

    console.log(`User deleted successfully: ${email}`);
  } catch (error) {
    console.error("Error deleting user from webhook:", error);
  }
}

module.exports = { handleClerkWebhook };
