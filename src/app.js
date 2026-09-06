// Must be first: ESM evaluates every import before this module's body runs, so
// a dotenv.config() call down here would land after config/env.js has already
// snapshotted process.env. The side-effect import keeps it in evaluation order.
import "dotenv/config";

import express from "express";
import { randomUUID } from "crypto";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import { config } from "./config/env.js";
import logger from "./utils/logger.js";
import { errSerializer } from "./utils/log-serializers.js";
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
import campaignRoute from "./routes/campaign.route.js";
import chartRoute from "./routes/chart.route.js";
import clerkWebhookRoute from "./routes/clerk-webhook.route.js";
import leadsApiRoute from "./routes/leads-api.route.js";
import leadsRoute from "./routes/leads.route.js";
import organizationRoute from "./routes/organization.route.js";
import postbackRoute from "./routes/postback.route.js";
import roleRoute from "./routes/role.route.js";
import routeRoute from "./routes/route.route.js";
import sellerRoute from "./routes/seller.route.js";
import subscriptionRoute from "./routes/subscription.route.js";
import userRoute from "./routes/user.route.js";
import webhookRoute from "./routes/webhook.route.js";
import webmasterRoute from "./routes/webmaster.route.js";
import { addUser } from "./controllers/user.controller.js";
import { authenticationContext } from "./middlewares/authentication-context.middleware.js";

const organizationContextStrict = authenticationContext();
const organizationContextOptional = authenticationContext({
  requireOrganization: false,
});

// clerk webhook route -> do not protect this route or move it to the end of the middleware chain
app.use("/api/v1/clerk-webhook", clerkWebhookRoute);

app.use(
  pinoHttp({
    logger,
    // Cloudflare stamps a unique id on every request. Reusing it joins these
    // logs to Cloudflare's own and survives a restart, which the default
    // per-process counter does not.
    genReqId: (req) => {
      const cfRay = req.headers["cf-ray"];
      return (typeof cfRay === "string" && cfRay) || randomUUID();
    },
    // Without this, req.log is bound to the whole serialized request, so every
    // application log line repeats the full header set.
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) => req.url === "/" || req.url === "/unauthenticated",
    },
    // The default serializer emits every request header on every line. Keep the
    // few fields that identify the caller.
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        ip: req.headers["cf-connecting-ip"] || req.remoteAddress,
        country: req.headers["cf-ipcountry"],
      }),
      res: (res) => ({ statusCode: res.statusCode }),
      err: errSerializer,
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);
app.use(express.json({ limit: config.requestLimit }));
app.use(cors({ origin: "*" }));
app.use(express.urlencoded({ extended: true, limit: config.requestLimit }));

// leads api
app.use("/api/v1/leads", leadsApiRoute);
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

export default app;