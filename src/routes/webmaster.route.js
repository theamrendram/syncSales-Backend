const {
  addWebmaster,
  getWebmasters,
  getWebmasterById,
  updateWebmaster,
  deleteWebmaster,
} = require("../controllers/webmaster.controller");

const router = require("express").Router();

router.post("/", addWebmaster);
router.get("/", getWebmasters);
router.get("/:id", getWebmasterById);
router.put("/:id", updateWebmaster);
router.delete("/:id", deleteWebmaster);

module.exports = router;