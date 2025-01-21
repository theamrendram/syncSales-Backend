const Razorpay = require("razorpay");

const instance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function createSubscription(req, res) {
  const { userId } = req.auth;
  try {
    const plan_id = "plan_PlzoYD151BM71y";

    const subscription = await instance.subscriptions.create({
      plan_id,
    //   customer_id: userId,
      customer_notify: 1,
      total_count: 1,
    });

    console.log(subscription);



    res.status(200).json({
        success: true,
        subscriptionId: subscription.id
    });
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to create subscription", details: error.message });
  }
}

async function paymentVerification(req, res) {
  const { userId } = req.auth;

  const {razorpay_signature, razorpay_payment_id, razorpay_subscription_id} = req.body();

  try {

    const user = await prismaClient.user.findUnique({
      where: {
        userId,
      },
    })
    const subscriptionId = user.subscriptionId;

    const generatedSignature = instance.utils.generate_signature(
      razorpay_payment_id,
      razorpay_subscription_id,
      process.env.RAZORPAY_KEY_SECRET
    );

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    const subscription = await instance.subscriptions.create({
      plan_id,
      customer_notify: 1,
      total_count: 1,
    });

    console.log(subscription);

    res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
    });
  } catch (error) {
    console.log(error);
    res
      .status(400)
      .json({ error: "Unable to create subscription", details: error.message });
  }
}


module.exports = {
  createSubscription,
  paymentVerification
};
