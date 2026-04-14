const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const pinoHttp = require("pino-http");
const { clerkMiddleware, requireAuth } = require("@clerk/express");
const { checkUserPlan } = require("./utils/check-user-plan");
const { config } = require("./config/env");
const logger = require("./utils/logger");
const app = express();
app.disable("x-powered-by");
app.set("query parser", "simple");

const trustProxySetting = process.env.TRUST_PROXY;
if (trustProxySetting === undefined) {
  // Most production deployments sit behind at least one reverse proxy/LB.
  app.set("trust proxy", 1);
} else if (trustProxySetting === "true") {
  app.set("trust proxy", true);
} else if (trustProxySetting === "false") {
  app.set("trust proxy", false);
} else if (!Number.isNaN(Number(trustProxySetting))) {
  app.set("trust proxy", Number(trustProxySetting));
} else {
  app.set("trust proxy", trustProxySetting);
}

// Routes
const campaignRoute = require("./routes/campaign.route");
const chartRoute = require("./routes/chart.route");
const clerkWebhookRoute = require("./routes/clerk-webhook.route");
const leadsApiRoute = require("./routes/leads-api.route");
const leadsRoute = require("./routes/leads.route");
const organizationRoute = require("./routes/organization.route");
const paymentRoute = require("./routes/payment.route");
const postbackRoute = require("./routes/postback.route");
const roleRoute = require("./routes/role.route");
const routeRoute = require("./routes/route.route");
const sellerRoute = require("./routes/seller.route");
const subscriptionRoute = require("./routes/subscription.route");
const dodoRoute = require("./routes/dodo.route");
const dodoPublicRoute = require("./routes/dodo-public.route");
const dodoWebhookRoute = require("./routes/dodo-webhook.route");
const userRoute = require("./routes/user.route");
const webhookRoute = require("./routes/webhook.route");
const webmasterRoute = require("./routes/webmaster.route");
const { addUser } = require("./controllers/user.controller");
const {
  authenticationContext,
} = require("./middlewares/authentication-context.middleware");

const organizationContextStrict = authenticationContext();
const organizationContextOptional = authenticationContext({
  requireOrganization: false,
});

// clerk webhook route -> do not protect this route or move it to the end of the middleware chain
app.use("/api/v1/clerk-webhook", clerkWebhookRoute);
app.use("/api/v1/dodo/webhook", dodoWebhookRoute);

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/",
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);
app.use(express.json({ limit: config.requestLimit }));
app.use(cors());
app.use(express.urlencoded({ extended: true, limit: config.requestLimit }));

// leads api
app.use("/api/v1/leads", checkUserPlan, leadsApiRoute);
app.use("/api/v1/postback", postbackRoute);
app.use("/api/v1/subscription", subscriptionRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/dodo-public", dodoPublicRoute);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.get("/unauthenticated", (req, res) => {
  res.send("unauthenticated request");
});

app.use("/api/v1/user/create", addUser);
app.use(clerkMiddleware());
app.use("/api/v1/user", requireAuth(), userRoute);
app.use("/api/v1/dodo", requireAuth(), dodoRoute);
app.use(
  "/api/v1/routes",
  requireAuth(),
  organizationContextStrict,
  routeRoute,
);
app.use("/api/v1/webhook", requireAuth(), webhookRoute);
app.use("/api/v1/seller", requireAuth(), sellerRoute);
app.use(
  "/api/v1/campaigns",
  requireAuth(),
  organizationContextStrict,
  campaignRoute,
);
app.use("/api/v1/webmaster", requireAuth(), webmasterRoute);
app.use("/api/v1/lead", requireAuth(), organizationContextOptional, leadsRoute);
app.use(
  "/api/v1/chart",
  requireAuth(),
  organizationContextStrict,
  chartRoute,
);
// Organization and role routes
app.use("/api/v1/org", requireAuth(), organizationContextStrict, organizationRoute);
app.use("/api/v1/org/role", requireAuth(), organizationContextStrict, roleRoute);

// test route for webhook
app.post("/webhook", (req, res) => {
  req.log.info("Lead webhook hit");

  res.send(req.body);
});
app.get("/webhook", (req, res) => {
  req.log.info("Lead webhook status check");

  res.send(req.body);
});

// Global error handling middleware
app.use((err, req, res, next) => {
  req.log.error({ err }, "Unhandled request error");
  res.status(500).json({ message: "Internal Server Error" });
});

module.exports = app;
