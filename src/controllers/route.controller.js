const prismaClient = require("../utils/prismaClient");

const getRoutes = async (req, res) => {
  const routes = await prismaClient.route.findMany();
  res.json(routes);
};

const addRoute = async (req, res) => {
  const {
    name,
    userId,
    product,
    description,
    payout,
    url,
    method,
    attributes,
  } = req.body;
  console.log(req.body);
  try {
    const route = await prismaClient.route.create({
      data: {
        name: name, // Ensure this is provided
        product: product, // Ensure this is provided
        payout: payout, // Ensure this is provided
        description: description, // Ensure this is provided
        hasWebhook: url ? true : false,
        url: url, // Ensure this is provided
        method: method, // Ensure this is provided
        attributes: attributes, // Ensure this is provided, should be in JSON format
        userId: userId, // Ensure this is provided
      },
    });
    return res.status(201).json({ success: true, data: route });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Unable to create route",
      details: error.message,
      success: false,
    });
  }
};

const getRouteById = async (req, res) => {
  const { id } = req.params;
  console.log(id);
  try {
    const route = await prismaClient.route.findUnique({
      where: {
        id,
      },
    });
    console.log(route);
    res.json(route);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get route", details: error.message });
  }
};

const editRoute = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    userId,
    product,
    description,
    payout,
    url,
    method,
    attributes,
  } = req.body;
  try {
    const route = await prismaClient.route.update({
      where: {
        id,
      },
      data: {
        name: name,
        product: product,
        payout: payout,
        description: description,
        url: url,
        method: method,
        attributes: attributes,
        userId: userId,
      },
    });
    res.json(route);
  } catch (error) {
    console.error(error);
    res
      .status(400)
      .json({ error: "Unable to update route", details: error.message });
  }
};

const getRouteByUser = async (req, res) => {
  const { userId } = req.params;
  try {
    const routes = await prismaClient.route.findMany({
      where: {
        AND: [{ userId }, { deletedAt: null }],
      },
    });
    res.json(routes);
  } catch (error) {
    res
      .status(400)
      .json({ error: "Unable to get routes", details: error.message });
  }
};

const deleteRouteById = async (req, res) => {
  const { id } = req.params;

  console.log("delete route called...", id);

  try {
    const response = await prismaClient.route.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    return res.status(200).json({
      message: "Route deleted successfully",
      success: true,
      data: response.id,
    });
  } catch (error) {
    console.error("Error deleting route:", error);
    return res.status(500).json({
      error: "Unable to delete route",
      details: error.message,
    });
  }
};

module.exports = {
  addRoute,
  editRoute,
  getRoutes,
  getRouteById,
  getRouteByUser,
  deleteRouteById,
};
