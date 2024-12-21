const prismaClient = require("../utils/prismaClient");

const getSellers = async (req, res) => {
  const sellers = await prismaClient.seller.findMany();
  res.json(sellers);
};

const getSellerById = async (req, res) => {
  const { id } = req.params;
  const seller = await prismaClient.seller.findUnique({
    where: {
      id,
    },
  });
  res.json(seller);
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
    console.log(seller);
    res.status(201).json(seller);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to create seller", details: error.message });
  }
};

const deleteSeller = async (req, res) => {
  const { id } = req.params;
  try {
    const seller = await prismaClient.seller.delete({
      where: {
        id,
      },
    });
    res.status(200).json(seller);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to delete seller", details: error.message });
  }
};
module.exports = { getSellers, addSeller, getSellerById, deleteSeller };
