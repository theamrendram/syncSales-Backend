const crypto = require("crypto");
const prismaClient = require("../utils/prismaClient");
const logger = require("../utils/logger");
const {
  createCheckoutSession,
  createCustomerPortalSession,
  getDodoWebhookSecret,
  diagnoseDodoConnection,
} = require("../utils/dodo-client");

function verifyDodoSignature(payload, signatureHeader, timestamp, secret) {
  if (!signatureHeader || !timestamp || !secret) return false;

  const providedSignature = signatureHeader.split(",")[1];
  if (!providedSignature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("base64");

  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);

  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function getSubscriptionStatusFromEvent(eventType) {
  switch (eventType) {
    case "subscription.active":
    case "subscription.renewed":
    case "subscription.updated":
    case "subscription.plan_changed":
      return "active";
    case "subscription.cancelled":
      return "cancelled";
    case "subscription.expired":
      return "expired";
    case "subscription.on_hold":
      return "trialing";
    default:
      return null;
  }
}

async function createDodoCheckoutSession(req, res) {
  const { productId, quantity = 1, trialPeriodDays, customer, returnUrl, metadata } = req.body;

  if (!productId || !customer?.email || !returnUrl) {
    return res.status(400).json({
      error: "productId, customer.email and returnUrl are required",
    });
  }

  try {
    const payload = {
      product_cart: [{ product_id: productId, quantity }],
      customer: {
        email: customer.email,
        name: customer.name,
      },
      return_url: returnUrl,
    };

    if (Number.isInteger(trialPeriodDays) && trialPeriodDays > 0) {
      payload.subscription_data = { trial_period_days: trialPeriodDays };
    }

    if (metadata && typeof metadata === "object") {
      payload.metadata = metadata;
    }

    const session = await createCheckoutSession(payload);

    return res.status(200).json({
      checkoutUrl: session.checkout_url,
      session,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to create Dodo checkout session");
    const isDnsFailure = error?.code === "ENOTFOUND";
    const upstreamStatus = Number(error?.status || error?.response?.status || 500);
    const providerDetails =
      error?.response?.data ||
      error?.error ||
      error?.message ||
      "Unknown Dodo provider error";
    return res.status(Number.isFinite(upstreamStatus) ? upstreamStatus : 500).json({
      error: isDnsFailure
        ? "Dodo checkout host could not be resolved from backend. Please retry or change DNS."
        : "Unable to create Dodo checkout session",
      details: providerDetails,
    });
  }
}

async function createDodoPortalSession(req, res) {
  const { customerId, returnUrl } = req.body;

  if (!customerId || !returnUrl) {
    return res.status(400).json({
      error: "customerId and returnUrl are required",
    });
  }

  try {
    const portal = await createCustomerPortalSession({
      customer_id: customerId,
      return_url: returnUrl,
    });

    return res.status(200).json({
      url: portal.url,
      portal,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to create Dodo portal session");
    return res.status(500).json({
      error: "Unable to create Dodo customer portal session",
      details: error.response?.data || error.message,
    });
  }
}

async function handleDodoWebhook(req, res) {
  const signature = req.headers["webhook-signature"];
  const timestamp = req.headers["webhook-timestamp"];
  const webhookId = req.headers["webhook-id"];
  const payload = req.body.toString("utf8");
  const secret = getDodoWebhookSecret();

  if (!verifyDodoSignature(payload, signature, timestamp, secret)) {
    return res.status(401).json({ error: "Invalid Dodo webhook signature" });
  }

  const eventTimeMs = Number(timestamp) * 1000;
  if (!Number.isFinite(eventTimeMs) || Math.abs(Date.now() - eventTimeMs) > 5 * 60 * 1000) {
    return res.status(401).json({ error: "Webhook timestamp outside tolerance window" });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  try {
    if (webhookId) {
      const alreadyProcessed = await prismaClient.processedWebhookEvent.findUnique({
        where: { id: webhookId },
      });

      if (alreadyProcessed) {
        return res.status(200).json({ received: true, duplicate: true });
      }
    }

    const data = event.data || {};
    const customerEmail = data.customer?.email || data.customer_email || null;
    const user = customerEmail
      ? await prismaClient.user.findUnique({ where: { email: customerEmail } })
      : null;
    const subscriptionStatus = getSubscriptionStatusFromEvent(event.type);
    const externalSubscriptionId = data.subscription_id || data.id || null;

    if (subscriptionStatus && externalSubscriptionId) {
      await prismaClient.subscription.upsert({
        where: { externalSubscriptionId },
        create: {
          paymentProvider: "dodo",
          externalSubscriptionId,
          externalPaymentId: data.payment_id || null,
          externalCustomerId: data.customer?.customer_id || null,
          billingCycle: String(data.payment_frequency_interval || "monthly"),
          plan: data.product_id || "dodo_plan",
          userId: user?.id || null,
          startDate: data.started_at ? new Date(data.started_at) : new Date(),
          endDate: data.next_billing_date
            ? new Date(data.next_billing_date)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nextBillingDate: data.next_billing_date ? new Date(data.next_billing_date) : null,
          cancelAtNextBillingDate: Boolean(data.cancel_at_next_billing_date),
          accessEndsAt: data.next_billing_date ? new Date(data.next_billing_date) : null,
          status: subscriptionStatus,
          customerEmail,
          metadata: data,
          razorpayPaymentId: data.payment_id || null,
          razorpaySubscriptionId: null,
        },
        update: {
          externalPaymentId: data.payment_id || null,
          externalCustomerId: data.customer?.customer_id || null,
          billingCycle: String(data.payment_frequency_interval || "monthly"),
          plan: data.product_id || undefined,
          userId: user?.id || undefined,
          endDate: data.next_billing_date ? new Date(data.next_billing_date) : undefined,
          nextBillingDate: data.next_billing_date ? new Date(data.next_billing_date) : null,
          cancelAtNextBillingDate: Boolean(data.cancel_at_next_billing_date),
          accessEndsAt: data.next_billing_date ? new Date(data.next_billing_date) : null,
          status: subscriptionStatus,
          customerEmail,
          metadata: data,
        },
      });
    }

    if (event.type === "payment.succeeded" && user?.id && data.payment_id) {
      const existingPayment = await prismaClient.payment.findFirst({
        where: { transactionId: data.payment_id },
      });

      if (!existingPayment) {
        await prismaClient.payment.create({
          data: {
            amount: (data.total_amount || 0) / 100,
            currency: data.currency || "USD",
            status: "succeeded",
            paymentMethod: "dodo",
            transactionId: data.payment_id,
            userId: user.id,
            description: "Dodo payment",
            metadata: data,
          },
        });
      }
    }

    if (webhookId) {
      await prismaClient.processedWebhookEvent.create({
        data: {
          id: webhookId,
          provider: "dodo",
          eventType: event.type,
          payload: event,
        },
      });
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error({ err: error, eventType: event?.type }, "Failed to process Dodo webhook");
    return res.status(500).json({ error: "Failed to process webhook" });
  }
}

async function getDodoHealth(req, res) {
  const diagnosis = await diagnoseDodoConnection();
  return res.status(diagnosis.ok ? 200 : 500).json(diagnosis);
}

module.exports = {
  createDodoCheckoutSession,
  createDodoPortalSession,
  handleDodoWebhook,
  getDodoHealth,
};
