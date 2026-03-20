const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const { clerkMiddleware, requireAuth } = require("@clerk/express");
const { LeadsLimiter } = require("./middlewares/rate-limiter.middleware");
const { checkUserPlan } = require("./utils/check-user-plan");
const app = express();

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
const routeRoute = require("./routes/route.route");
const userRoute = require("./routes/user.route");
const webhookRoute = require("./routes/webhook.route");
const sellerRoute = require("./routes/seller.route");
const campaignRoute = require("./routes/campaign.route");
const leadsRoute = require("./routes/leads.route");
const leadsApiRoute = require("./routes/leads-api.route");
const postbackRoute = require("./routes/postback.route");
const paymentRoute = require("./routes/payment.route");
const webmasterRoute = require("./routes/webmaster.route");
const subscriptionRoute = require("./routes/subscription.route");
const organizationRoute = require("./routes/organization.route");
const roleRoute = require("./routes/role.route");
const chartRoute = require("./routes/chart.route");
const clerkWebhookRoute = require("./routes/clerk-webhook.route");
const { addUser } = require("./controllers/user.controller");

// clerk webhook route -> do not protect this route or move it to the end of the middleware chain
app.use("/api/v1/clerk-webhook", clerkWebhookRoute);

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// leads api
app.use("/api/v1/leads", checkUserPlan, leadsApiRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/postback", postbackRoute);
app.use("/api/v1/subscription", subscriptionRoute);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.get("/unauthenticated", (req, res) => {
  res.send("unauthenticated request");
});

app.use("/api/v1/user/create", addUser);
app.use(clerkMiddleware());
app.use("/api/v1/user", requireAuth(), userRoute);
app.use("/api/v1/route", requireAuth(), routeRoute);
app.use("/api/v1/webhook", requireAuth(), webhookRoute);
app.use("/api/v1/seller", requireAuth(), sellerRoute);
app.use("/api/v1/campaign", requireAuth(), campaignRoute);
app.use("/api/v1/webmaster", requireAuth(), webmasterRoute);
app.use("/api/v1/lead", requireAuth(), leadsRoute);
app.use("/api/v1/chart", requireAuth(), chartRoute);
// Organization and role routes
app.use("/api/v1/org", requireAuth(), organizationRoute);
app.use("/api/v1/org/role", requireAuth(), roleRoute);

// test route for webhook
app.post("/webhook", (req, res) => {
  console.log("req.body from lead -> webhook", req.body);

  res.send(req.body);
});
app.get("/webhook", (req, res) => {
  console.log("req.body from lead -> webhook", req.body);

  res.send(req.body);
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ message: "Internal Server Error" });
});

module.exports = app;
