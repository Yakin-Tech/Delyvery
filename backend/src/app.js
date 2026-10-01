const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// In production the API sits behind the host's load balancer (one hop), so
// req.ip would otherwise be the proxy's address for every visitor — which
// would make the portal rate limiter (keyed on token + IP) shared by everyone.
// Trusting exactly one hop reads the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
}

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

module.exports = app;
