import prismaClient from "../utils/prismaClient.js";
import jwt from "jsonwebtoken";

const loginUser = async (req, res) => {
    const {email, password} = req.body;

    const user = await prismaClient.user.findUnique({
        where: {
            email
        }
    })

    if(!user) {
        return res.status(401).json({message: "Invalid credentials"})
    }
}