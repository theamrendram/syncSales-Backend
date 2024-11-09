const { PrismaClient } = require("@prisma/client");
const prismaClient = new PrismaClient();

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
        url: url, // Ensure this is provided
        method: method, // Ensure this is provided
        attributes: attributes, // Ensure this is provided, should be in JSON format
        userId: userId, // Ensure this is provided
      },
    });
    return res.json(route);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "Unable to create route", details: error.message });
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
  console.log("edit", req.body);
  try {
    const route = await prismaClient.route.update({
      where: {
        id,
      },
      data: {
        name: name, // Ensure this is provided
        product: product, // Ensure this is provided
        payout: payout, // Ensure this is provided
        description: description, // Ensure this is provided
        url: url, // Ensure this is provided
        method: method, // Ensure this is provided
        attributes: attributes, // Ensure this is provided, should be in JSON format
        userId: userId, // Ensure this is provided
      },
    });
    console.log(route);
    res.json(route);
  } catch (error) {
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
        userId,
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

  try {
    // Convert id if necessary
    const routeId = String(id);

    // Step 1: Delete associated campaigns only
    await prismaClient.campaign.deleteMany({
      where: { routeId },
    });

    // Step 2: Delete the route itself
    const deletedRoute = await prismaClient.route.delete({
      where: { id: routeId },
    });

    return res.status(200).json({
      message: "Route and associated campaigns deleted successfully",
      data: deletedRoute,
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
