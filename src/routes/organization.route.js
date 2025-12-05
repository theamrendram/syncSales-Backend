const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();

const {
  createOrganization,
  getUserOrganizations,
  getOrganization,
  updateOrganization,
  getMembers,
  addMember,
  removeMember,
} = require("../controllers/organization.controller");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images allowed!"), false);
    }
  },
});

// Organization CRUD
router.post("/", createOrganization);
router.get("/user", getUserOrganizations);
router.get("/:organizationId", getOrganization);
router.put("/:organizationId", updateOrganization);

// Member management
router.get("/:organizationId/members", getMembers);
router.post("/:organizationId/members", addMember);
router.delete("/:organizationId/members/:memberId", removeMember);

module.exports = router;
