const {addWebmaster, getWebmastersByUser, updateWebmaster} = require('../controllers/webmaster.controller');

const router = require('express').Router();

router.post('/', addWebmaster);
router.get('/', getWebmastersByUser);
router.put('/:id', updateWebmaster);

module.exports = router