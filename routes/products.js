const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/productsController");

router.post("/scrape", ctrl.scrape);

module.exports = router;
