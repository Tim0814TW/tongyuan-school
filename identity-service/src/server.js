import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createIdentityRepository } from "./repository.js";
import { createAuthService } from "./auth.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl, config.nodeEnv);
const repository = createIdentityRepository(pool);
const authService = createAuthService({ repository, jwtSecret: config.jwtSecret, jwtExpiresIn: config.jwtExpiresIn });
const app = createApp({ config, repository, authService });

app.listen(config.port, () => {
  console.log(`Tongyuan Identity listening on http://127.0.0.1:${config.port}`);
});
