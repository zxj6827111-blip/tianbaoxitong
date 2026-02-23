const express = require('express');
const {
  isMetricsEnabled,
  isMetricsAuthorized,
  getPrometheusMetricsPayload,
  getPrometheusMetricsContentType
} = require('../services/metricsService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  if (!isMetricsEnabled()) {
    return res.status(404).send('metrics disabled');
  }

  if (!isMetricsAuthorized(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).send('unauthorized');
  }

  try {
    const metricsPayload = await getPrometheusMetricsPayload();
    res.setHeader('Content-Type', getPrometheusMetricsContentType());
    return res.status(200).send(metricsPayload);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
