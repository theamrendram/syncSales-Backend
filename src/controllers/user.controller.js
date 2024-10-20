const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();
const addUser = async (req, res) => {
  const { firstName, lastName, email, password, companyName, role } = req.body;
  try {
    const user = await prismaClient.user.create({
      data: {
        firstName,
        lastName,
        email,
        password,
        companyName,
        role,
      },
    });
    res.status(201).json(user);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to create user", details: error.message });
  }
};

module.exports = {
  addUser,
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