/**
 * Zoho Inventory configuration, read from environment variables (never stored in the database, never sent to the browser).
 *
 *   ZOHO_DC               data centre: in (default), com, eu, com.au, jp, ca, sa — must match where your Zoho account lives
 *   ZOHO_CLIENT_ID        OAuth client from https://api-console.zoho.<dc>  (Self Client)
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REFRESH_TOKEN    long-lived token generated once from the Self Client
 *   ZOHO_ORGANIZATION_ID  Zoho Inventory → Settings → Organization Profile
 *
 * ZOHO_API_BASE / ZOHO_ACCOUNTS_BASE override the hosts. They exist so the integration can be exercised against a local mock.
 */

export interface ZohoConfig {
  dc: string;
  apiBase: string;
  accountsBase: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  organizationId: string;
}

const REGIONS: Record<string, { api: string; accounts: string }> = {
  com: { api: "https://www.zohoapis.com", accounts: "https://accounts.zoho.com" },
  in: { api: "https://www.zohoapis.in", accounts: "https://accounts.zoho.in" },
  eu: { api: "https://www.zohoapis.eu", accounts: "https://accounts.zoho.eu" },
  "com.au": { api: "https://www.zohoapis.com.au", accounts: "https://accounts.zoho.com.au" },
  jp: { api: "https://www.zohoapis.jp", accounts: "https://accounts.zoho.jp" },
  ca: { api: "https://www.zohoapis.ca", accounts: "https://accounts.zohocloud.ca" },
  sa: { api: "https://www.zohoapis.sa", accounts: "https://accounts.zoho.sa" },
};

export const ZOHO_DATA_CENTRES = Object.keys(REGIONS);
export const ZOHO_REQUIRED_VARS = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"] as const;

export interface ZohoConfigStatus {
  config: ZohoConfig | null;
  dc: string;
  /** Names (never values) of required variables that are not set. */
  missing: string[];
  problem: string | null;
}

export function readZohoConfig(env: Record<string, string | undefined> = process.env): ZohoConfigStatus {
  const dc = (env.ZOHO_DC ?? "").trim().toLowerCase() || "in";
  const missing = ZOHO_REQUIRED_VARS.filter((name) => !(env[name] ?? "").trim());
  const region = REGIONS[dc];
  const apiBase = (env.ZOHO_API_BASE ?? "").trim() || region?.api;
  const accountsBase = (env.ZOHO_ACCOUNTS_BASE ?? "").trim() || region?.accounts;

  if (!apiBase || !accountsBase) {
    return { config: null, dc, missing: [...missing], problem: `ZOHO_DC "${dc}" is not recognised. Use one of: ${ZOHO_DATA_CENTRES.join(", ")}.` };
  }
  if (missing.length) return { config: null, dc, missing: [...missing], problem: null };

  return {
    dc,
    missing: [],
    problem: null,
    config: {
      dc,
      apiBase: apiBase.replace(/\/+$/, ""),
      accountsBase: accountsBase.replace(/\/+$/, ""),
      clientId: env.ZOHO_CLIENT_ID!.trim(),
      clientSecret: env.ZOHO_CLIENT_SECRET!.trim(),
      refreshToken: env.ZOHO_REFRESH_TOKEN!.trim(),
      organizationId: env.ZOHO_ORGANIZATION_ID!.trim(),
    },
  };
}
