const {addWebmaster, getWebmastersByUser, updateWebmaster, deleteWebmaster} = require('../controllers/webmaster.controller');

const router = require('express').Router();

router.post('/', addWebmaster);
router.get('/', getWebmastersByUser);
router.put('/:id', updateWebmaster);
router.delete('/:id', deleteWebmaster);

module.exports = router