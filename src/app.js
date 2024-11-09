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

app.get("/protected", requireAuth(), async (req, res) => {
  try {
    const { userId } = req.auth;
    const user = await clerkClient.users.getUser(userId);
    return res.json({ user });
  } catch (error) {
    console.error("Failed to fetch user data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.use("/api/v1/route", routeRoute);
app.use("/api/v1/user", userRoute);
app.use("/api/v1/webhook", webhookRoute);
app.use("/api/v1/seller", sellerRoute);
app.use("/api/v1/campaign", campaignRoute);
app.use("/api/v1/lead", leadsRoute);

app.get("/test", (req, res) => {
  res.send("test route");
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ message: "Internal Server Error" });
});

module.exports = app;
