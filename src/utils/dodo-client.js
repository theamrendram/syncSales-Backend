let dodoClientPromise = null;

function getDodoEnvironment() {
  return process.env.DODO_PAYMENTS_ENVIRONMENT || "live_mode";
}

function getDodoApiKey() {
  return process.env.DODO_PAYMENTS_API_KEY;
}

function getDodoWebhookSecret() {
  return process.env.DODO_PAYMENTS_WEBHOOK_SECRET;
}

async function getDodoClient() {
  const apiKey = getDodoApiKey();
  if (!apiKey) {
    throw new Error("Missing DODO_PAYMENTS_API_KEY");
  }

  if (!dodoClientPromise) {
    dodoClientPromise = import("dodopayments").then((module) => {
      const DodoPayments = module.default;
      return new DodoPayments({
        bearerToken: apiKey,
        environment: getDodoEnvironment(),
      });
    });
  }

  return dodoClientPromise;
}

async function createCheckoutSession(payload) {
  const client = await getDodoClient();
  return client.checkoutSessions.create(payload);
}

async function createCustomerPortalSession(payload) {
  const client = await getDodoClient();
  return client.customers.createPortalSession(payload);
}

async function diagnoseDodoConnection() {
  const apiKey = getDodoApiKey();
  const environment = getDodoEnvironment();
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : null;

  if (!apiKey) {
    return {
      ok: false,
      environment,
      hasApiKey: false,
      maskedKey,
      message: "DODO_PAYMENTS_API_KEY is missing",
    };
  }

  try {
    const client = await getDodoClient();
    if (typeof client.products?.list !== "function") {
      return {
        ok: true,
        environment,
        hasApiKey: true,
        maskedKey,
        message: "SDK initialized (products.list unavailable for probe)",
      };
    }

    await client.products.list({});
    return {
      ok: true,
      environment,
      hasApiKey: true,
      maskedKey,
      message: "SDK auth probe succeeded",
    };
  } catch (error) {
    return {
      ok: false,
      environment,
      hasApiKey: true,
      maskedKey,
      status: error?.status || error?.response?.status || null,
      message: error?.message || "SDK auth probe failed",
      details: error?.error || error?.response?.data || null,
    };
  }
}

module.exports = {
  createCheckoutSession,
  createCustomerPortalSession,
  getDodoWebhookSecret,
  diagnoseDodoConnection,
};
