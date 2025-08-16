const { PrismaClient } = require("../utils/prismaClient");
const jwt = require("jsonwebtoken");

const loginUser = async (req, res) => {
    const {email, password} = req.body;

    const user = await PrismaClient.user.findUnique({
        where: {
            email
        }
    })

    if(!user) {
        return res.status(401).json({message: "Invalid credentials"})
    }
}