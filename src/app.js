const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const routeRoute = require("./routes/route.route");
const userRoute = require("./routes/user.route");
const webhookRoute = require("./routes/webhook.route");
const sellerRoute = require("./routes/seller.route");
const campaignRoute = require("./routes/campaign.route");
const leadsRoute = require("./routes/lead.route");
dotenv.config();

app.get("/", (req, res) => {
  res.send("server is running");
});

app.use(express.json());
app.use(cors());

app.use("/api/v1/route", routeRoute);
app.use("/api/v1/user", userRoute);
app.use("/api/v1/webhook", webhookRoute);
app.use("/api/v1/seller", sellerRoute);
app.use("/api/v1/campaign", campaignRoute);
app.use("/api/v1/lead", leadsRoute);

app.get("/test", (req, res) => {
  res.send("test route");
});

module.exports = app;
