const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { clerkMiddleware, requireAuth, clerkClient } = require("@clerk/express");

dotenv.config();

const app = express();
app.use(clerkMiddleware());
app.use(express.json());
app.use(cors());

// Routes
const routeRoute = require("./routes/route.route");
const userRoute = require("./routes/user.route");
const webhookRoute = require("./routes/webhook.route");
const sellerRoute = require("./routes/seller.route");
const campaignRoute = require("./routes/campaign.route");
const leadsRoute = require("./routes/lead.route");

app.get("/", (req, res) => {
  res.send("server is running");
});

app.get("/unauthenticated", (req, res) => {
  res.send("unauthenticated request");
});

app.use("/api/v1/route", requireAuth(), routeRoute);
app.use("/api/v1/user", requireAuth(), userRoute);
app.use("/api/v1/webhook", requireAuth(), webhookRoute);
app.use("/api/v1/seller", requireAuth(), sellerRoute);
app.use("/api/v1/campaign", requireAuth(), campaignRoute);
app.use("/api/v1/lead", requireAuth(), leadsRoute);

app.get("/test", (req, res) => {
  res.send("test route");
});


// test route for webhook
app.post("/webhook", (req, res) => {

  console.log("req.body from lead -> webhook", req.body);

  res.send(req.body);
});


// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ message: "Internal Server Error" });
});

module.exports = app;
