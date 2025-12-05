const prismaClient = require("../utils/prismaClient");
const { generateKey } = require("../utils/generate-key");
const { clerkClient } = require("@clerk/express");
const addUser = async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password = "",
    companyName,
    role,
  } = req.body;

  console.log("req.body", req.body);
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    const userExists = await prismaClient.user.findUnique({
      where: {
        email: email,
      },
    });

    if (userExists) {
      return res
        .status(400)
        .json({ error: "User already exists with this email" });
    }

    const clerkUser = await clerkClient.users.createUser({
      username: email.split("@")[0].replace(/\./g, ""),
      emailAddress: [email],
      password,
      firstName,
      lastName,
      deleteSelfEnabled: false,
    });

    console.log("clerkUser", clerkUser);

    const user = await prismaClient.user.create({
      data: {
        id: clerkUser.id,
        firstName,
        lastName,
        email,
        password,
        companyName,
        role: role || "user",
        apiKey:
          Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15),
      },
    });
    res.status(201).json(user);
  } catch (error) {
    console.log(error);
    // Clerk errors come with `errors` array
    if (error.errors && Array.isArray(error.errors)) {
      return res.status(400).json({
        error: "ClerkError",
        details: error.errors.map((e) => ({
          code: e.code,
          message: e.message,
          longMessage: e.longMessage,
          meta: e.meta,
        })),
      });
    }

    // Fallback for other errors
    res.status(500).json({
      error: "Unable to create user",
      details: error.message,
    });
  }
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
    });
    return res.status(200).json({ data: user });
  } catch (error) {
    console.error("Error in getUser:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
};

module.exports = {
  addUser,
  getUser,
  getAllUsers,
  addUserAPI,
  getUserAPI,
};

// {
//     "id": "74185bb4-dc74-47d1-9b68-222717c423c9",
//     "firstName": "Bruce",
//     "lastName": "Wayne",
//     "email": "bruce.wayne@wayneenterprises.com",
//     "password": "iAmBatman123!",
//     "companyName": "Wayne Enterprises",
//     "role": "admin"
// }
