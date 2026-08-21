'use strict';
/** 分散ソースのバンドル配信（/app.js, /styles.css）— llytpr-wl.v01nh. */
const express = require('express');
const bundle = require('../client-bundle');

const router = express.Router();
router.get('/app.js', bundle.app);
router.get('/styles.css', bundle.styles);

module.exports = { router };
