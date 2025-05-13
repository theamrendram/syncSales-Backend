const { clerkClient } = require("@clerk/express");
const prismaClient = require("../utils/prismaClient");
const { generateKey } = require("../utils/generate-key");

async function getSubscription(req, res) {
  const body = req.body;
  const { plan, razorpayPaymentId, razorpayOrderId,  } = req.body;
  const { firstName, lastName, phone, email, password, company, address } =
    body.customer;

  console.log("body", body);

  try {
    // const userExists = await prismaClient.user.findUnique({
    //   where: {
    //     email,
    //   },
    // });
    // if (userExists) {
    //   return res.status(400).json({ error: "User already exists" });
    // }

    // const clerkUser = clerkClient.users.createUser({
    //   username: firstName + Math.floor(Math.random() * 1000),
    //   emailAddress: [email],
    //   password,
    //   firstName: firstName,
    //   lastName: lastName,
    //   deleteSelfEnabled: false,
    // });

    // if (!clerkUser) {
    //   return res
    //     .status(500)
    //     .json({ error: "There was some error while signing up" });
    // }
    // console.log("clerk user", clerkUser);
    // // await clerkClient.users.updateUserMetadata(clerkUser.id, {
    // //   privateMetadata: {
    // //     role: "user",
    // //   },
    // // });

    // const user = await prismaClient.user.create({
    //   data: {
    //     firstName,
    //     lastName,
    //     phone,
    //     email,
    //     password,
    //     plan,
    //     companyName: company,
    //     address,
    //     apiKey: generateKey(),
    //   },
    // });
    res.send("user");
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error });
  }
}

module.exports = {
  getSubscription,
};
