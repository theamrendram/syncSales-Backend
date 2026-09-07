import prismaClient from "../utils/prismaClient.js";
import { generateKey } from "../utils/generate-key.js";

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  companyName: true,
  apiKey: true,
  createdAt: true,
  updatedAt: true,
  address: true,
  phone: true,
  organizationId: true,
};

const userApiKeySelect = {
  id: true,
  apiKey: true,
};
const addUser = async (req, res) => {
  // Registration is owned by Better Auth (`POST /api/auth/sign-up/email`) and
  // by the organization plugin's invitation flow. This handler used to create
  // an identity-provider user plus a User row carrying a live apiKey, and it
  // was additionally mounted unauthenticated at /api/v1/user/create — an open
  // account-creation endpoint. It stays only to answer callers still pointing
  // at the old path.
  return res.status(403).json({ error: "Signups are currently disabled" });
};


const getAllUsers = async (req, res) => {
  try {
    const users = await prismaClient.user.findMany();
    res.json(users);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Unable to fetch users", details: error.message });
  }
};

const addUserAPI = async (req, res) => {
  const { userId } = req.auth;
  try {
    const user = await prismaClient.user.findUnique({
      where: {
        id: userId,
      },
      select: userApiKeySelect,
    });
    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    if (user.apiKey) {
      return res.status(400).json({ error: "API key already exists" });
    }

    const updatedUser = await prismaClient.user.update({
      where: {
        id: userId,
      },
      data: {
        apiKey: generateKey(),
      },
      select: userApiKeySelect,
    });
    return res.status(200).json({ apiKey: updatedUser.apiKey });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error });
  }
};

const getUserAPI = async (req, res) => {
  const { userId } = req.auth;
  try {
    const user = await prismaClient.user.findUnique({
      where: {
        id: userId,
      },
      select: userSelect,
    });
    console.log(user);
    return res.status(200).json({ data: user });
  } catch (error) {
    console.error("Error in getUserAPI:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
};

const getUser = async (req, res) => {
  const { userId } = req.auth;
  try {
    const user = await prismaClient.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        ...userSelect,
        webmasterProfile: { select: { userId: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { webmasterProfile, ...userData } = user;

    // Same discriminator as resolveIsWebmaster() in
    // authentication-context.middleware.js: a WebmasterProfile is what makes a
    // user a webmaster. Everyone else is an admin — self-serve signups have no
    // organization or membership until they create one, so any check based on
    // those would misclassify them.
    return res.status(200).json({
      data: { ...userData, role: webmasterProfile ? "webmaster" : "admin" },
    });
  } catch (error) {
    console.error("Error in getUser:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
};

export { addUser, getUser, getAllUsers, addUserAPI, getUserAPI };

// {
//     "id": "74185bb4-dc74-47d1-9b68-222717c423c9",
//     "firstName": "Bruce",
//     "lastName": "Wayne",
//     "email": "bruce.wayne@wayneenterprises.com",
//     "password": "iAmBatman123!",
//     "companyName": "Wayne Enterprises",
//     "role": "admin"
// }
