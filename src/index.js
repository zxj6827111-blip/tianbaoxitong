const dotenv = require('dotenv');

dotenv.config();

const { getJwtSecret } = require('./auth/jwt');
const app = require('./app');

const port = process.env.PORT || 3000;

// Fail fast for weak JWT configuration in non-test environments.
getJwtSecret();

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
