const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const { clerkMiddleware, requireAuth } = require("@clerk/express");
const { LeadsLimiter } = require("./middlewares/rate-limiter.middleware");
const { checkUserPlan } = require("./utils/check-user-plan");
const app = express();

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

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

// leads api
app.use("/api/v1/leads", LeadsLimiter, checkUserPlan, leadsApiRoute);
app.use("/api/v1/payment", paymentRoute);
app.use("/api/v1/postback", postbackRoute);
app.use("/api/v1/subscription", subscriptionRoute);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.get("/unauthenticated", (req, res) => {
  res.send("unauthenticated request");
});

app.use(clerkMiddleware());
app.use("/api/v1/user", userRoute);
app.use("/api/v1/route", requireAuth(), routeRoute);
app.use("/api/v1/webhook", requireAuth(), webhookRoute);
app.use("/api/v1/seller", requireAuth(), sellerRoute);
app.use("/api/v1/campaign", requireAuth(), campaignRoute);
app.use("/api/v1/webmaster", requireAuth(), webmasterRoute);
app.use("/api/v1/lead", requireAuth(), leadsRoute);

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
