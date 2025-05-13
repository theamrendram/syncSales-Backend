const crypto = require("crypto");
const Razorpay = require("razorpay");
const prismaClient = require("../utils/prismaClient");
const instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function createSubscription(req, res) {
  const { plan, isTrial, billingCycle, customer } = req.body;

  console.log("body", req.body);

  if (!plan || !billingCycle || typeof isTrial !== "boolean" || !customer) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log("body", req.body);
  try {
    const plan_id =
      plan === "pro" ? "plan_PlzoYD151BM71y" : "plan_QLDExaOJEQ4R11";

    let razorpay_customer;

    // Check if the customer already exists in Razorpay
    const existingCustomers = await instance.customers.all({
      email: customer.email,
    });

    if (existingCustomers.items.length > 0) {
      razorpay_customer = existingCustomers.items[0];
      console.log("Existing customer found:", razorpay_customer);
    } else {
      razorpay_customer = await instance.customers.create({
        name: customer.firstName + " " + customer.lastName,
        email: customer.email,
        contact: customer.phone,
        notes: {
          address: customer.address,
        },
      });
      console.log("New customer created:", razorpay_customer);
    }

    const subscription = await instance.subscriptions.create({
      plan_id,
      customer_id: razorpay_customer.id,
      customer_notify: 1,
      total_count: 1,
    });

    console.log("subscription", subscription);

    res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
    });
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to create subscription", details: error.message });
  }
}

async function verifySubscription(req, res) {
  const {
    razorpayPaymentId,
    razorpaySubscriptionId,
    razorpaySignature,
    plan,
    billingCycle,
    isTrial,
    customer,
  } = req.body;

  console.log("body", req.body);

  if (!razorpayPaymentId || !razorpaySubscriptionId || !razorpaySignature) {
    return res.status(400).json({ error: "Missing Razorpay payment details" });
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`, "utf-8")
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const user = await prismaClient.user.findUnique({
      where: {
        email: customer.email,
      },
    });

    const subscription = await prismaClient.subscription.create({
      data: {
        razorpaySubscriptionId,
        razorpayPaymentId,
        customerEmail: customer.email,
        billingCycle,
        isTrial,
        plan,
        startDate: new Date(),
        endDate: new Date(
          Date.now() + (isTrial ? 7 : 30) * 24 * 60 * 60 * 1000
        ),
        status: "active",
        userId: user?.id ?? null,
      },
    });

    return res.status(200).json({ success: true, subscription });
  } catch (error) {
    console.error("Verification failed:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = {
  createSubscription,
  verifySubscription,
};
