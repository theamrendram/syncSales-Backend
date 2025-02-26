const {addWebmaster, getWebmastersByUser} = require('../controllers/webmaster.controller');

const router = require('express').Router();

router.post('/', addWebmaster);
router.get('/', getWebmastersByUser);

module.exports = router