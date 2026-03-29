const prisma = require("../utils/prismaClient");
const { Webhook } = require("svix");
const logger = require("../utils/logger");
const { generateKey } = require("../utils/generate-key");

// Handle Clerk webhook events
const handleClerkWebhook = async (req, res) => {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

    if (!WEBHOOK_SECRET) {
      logger.error("Missing CLERK_WEBHOOK_SIGNING_SECRET environment variable");
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
      logger.warn({ err }, "Webhook signature verification failed");
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Extract event
    const { type, data } = evt;
    logger.info({ type }, "Webhook received");

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
        logger.warn({ type }, "Unhandled webhook event type");
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Webhook error");
    res.status(500).json({ error: "Internal server error" });
  }
};

// Handle user creation
async function handleUserCreated(data) {
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      logger.warn("No email found in user data");
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      logger.info({ email }, "User already exists");
      return;
    }

    // Create user in database
    const user = await prisma.user.create({
      data: {
        id: data.id,
        email,
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        apiKey: generateKey(),
      },
    });

    logger.info({ email: user.email }, "User created from webhook");
  } catch (error) {
    logger.error({ err: error }, "Error creating user from webhook");
  }
}

// Handle user updates
async function handleUserUpdated(data) {
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      logger.warn("No email found in user data");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      logger.info({ email }, "User not found for update");
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

    logger.info({ email }, "User updated from webhook");
  } catch (error) {
    logger.error({ err: error }, "Error updating user from webhook");
  }
}

// Handle user deletion
async function handleUserDeleted(data) {
  try {
    const email = data.email_addresses[0]?.email_address;

    if (!email) {
      logger.warn("No email found in user data");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      logger.info({ email }, "User not found for deletion");
      return;
    }

    // Delete user from database
    await prisma.user.delete({
      where: { email },
    });

    logger.info({ email }, "User deleted from webhook");
  } catch (error) {
    logger.error({ err: error }, "Error deleting user from webhook");
  }
}

module.exports = { handleClerkWebhook };
