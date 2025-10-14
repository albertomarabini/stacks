// config.ts
export const Config = {
    PORT: Number(process.env.PORT || 3000),
    SESSION_SECRET: process.env.SESSION_SECRET,          // REQUIRED
    BRIDGE_BASE_URL: process.env.BRIDGE_BASE_URL,        // REQUIRED
    BRIDGE_API_KEY: process.env.BRIDGE_API_KEY || "",    // merchant key for Bridge
    BRIDGE_ADMIN_KEY: process.env.BRIDGE_ADMIN_KEY || "",// admin key for Bridge (if you call adminy routes)
    DEPLOYMENT_NETWORK: process.env.DEPLOYMENT_NETWORK || "testnet",
  };
