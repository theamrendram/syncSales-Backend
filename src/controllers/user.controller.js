const prismaClient = require("../utils/prismaClient");
const { generateKey } = require("../utils/generate-key");
const addUser = async (req, res) => {
  const { firstName, lastName, email, password, companyName, role, userId } =
    req.body;
  console.log(req.body);
  try {
    const user = await prismaClient.user.create({
      data: {
        id: userId,
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
    res
      .status(400)
      .json({ error: "Unable to create user", details: error.message });
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
    return res.status(500).json({ error: error });
  }
};

module.exports = {
  addUser,
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
