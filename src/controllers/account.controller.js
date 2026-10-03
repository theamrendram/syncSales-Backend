/**
 * The signed-in user's own account: profile details, which sign-in methods
 * are linked, and what the organization lets them change. Mounted at
 * /api/v1/user/account.
 *
 * Changing or resetting an existing password and linking Google go straight
 * to Better Auth from the client; only what Better Auth keeps server-only
 * lives here.
 */
import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";

import prismaClient from "../utils/prismaClient.js";
import { auth } from "../lib/auth.js";
import { getMemberAuthPolicy } from "../lib/member-auth-policy.js";

const profileSelect = {
  firstName: true,
  lastName: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  phone: true,
  companyName: true,
  createdAt: true,
};

// The caller's profile, how they sign in, and what they may change about it.
const getAccountSecurity = async (req, res) => {
  const { userId } = req.auth;
  try {
    const [profile, accounts, policy] = await Promise.all([
      prismaClient.user.findUnique({
        where: { id: userId },
        select: profileSelect,
      }),
      prismaClient.account.findMany({
        where: { userId },
        select: { providerId: true },
      }),
      getMemberAuthPolicy(userId),
    ]);

    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile,
        hasPassword: accounts.some((a) => a.providerId === "credential"),
        hasGoogle: accounts.some((a) => a.providerId === "google"),
        ...policy,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "failed to load account security");
    return res.status(500).json({ error: "Failed to load account security" });
  }
};

const setPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

// Better Auth's setPassword is server-only, so a Google-only user adds a
// password through here. The account.create hook in lib/auth.js enforces the
// organization's member option as well; the early check gives a clean 403.
const setPassword = async (req, res) => {
  const { userId } = req.auth;
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Password must be between 8 and 128 characters" });
  }

  try {
    const policy = await getMemberAuthPolicy(userId);
    if (!policy.canManagePassword) {
      return res.status(403).json({
        error: "Your organization owner has not enabled password management",
      });
    }

    const existing = await prismaClient.account.findFirst({
      where: { userId, providerId: "credential" },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: "A password is already set" });
    }

    await auth.api.setPassword({
      body: { newPassword: parsed.data.newPassword },
      headers: fromNodeHeaders(req.headers),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "failed to set password");
    const status = error?.statusCode ?? error?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).json({ error: error.message });
    }
    return res.status(500).json({ error: "Failed to set password" });
  }
};

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(50),
    lastName: z.string().trim().max(50).default(""),
    phone: optionalText(30).refine(
      (v) => v == null || /^[0-9+\-() ]+$/.test(v),
      "Phone may only contain digits, spaces and + - ( )",
    ),
    companyName: optionalText(100),
  })
  .strict();

// Edits the caller's own profile. Email is deliberately absent: changing it
// needs Better Auth's verified change-email flow, not a column write.
const updateProfile = async (req, res) => {
  const { userId } = req.auth;
  const parsed = updateProfileSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      error: issue?.message ?? "Invalid profile",
      field: issue?.path?.[0],
    });
  }

  const { firstName, lastName, ...rest } = parsed.data;
  try {
    const profile = await prismaClient.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        // Better Auth reads `name`; the rest of the API reads first/last.
        // Keep the two in step on every edit.
        name: `${firstName} ${lastName}`.trim(),
        ...rest,
      },
      select: profileSelect,
    });

    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    req.log.error({ err: error }, "failed to update profile");
    return res.status(500).json({ error: "Failed to update profile" });
  }
};

export { getAccountSecurity, setPassword, updateProfile };
