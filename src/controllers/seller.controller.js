const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();

const getSellers = async (req, res) => {
  const sellers = await prismaClient.seller.findMany();
  res.json(sellers);
};

const addSeller = async (req, res) => {
  const { name, apiKey } = req.body;
  try {
    const seller = await prismaClient.seller.create({
      data: {
        name,
        apiKey,
      },
    });
    res.status(201).json(seller);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to create seller", details: error.message });
  }
};


module.exports = { getSellers, addSeller };
