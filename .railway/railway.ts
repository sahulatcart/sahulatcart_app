import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const sahulatcart_app = github("sahulatcart/sahulatcart_app", { checkSuites: false });

  const site = service("site", {
    source: sahulatcart_app,
    build: { builder: "DOCKERFILE", dockerfilePath: "site/Dockerfile", watchPatterns: ["/site/**"] },
    start: "nginx -g 'daemon off;'",
    replicas: { "sfo": 1 },
  });
  const _appbackend = service("@app/backend", {
    source: sahulatcart_app,
    build: { buildCommand: "npm run build --workspace=@app/backend", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/backend/**"] },
    start: "node backend/dist/index.js",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "appbackend" },
    env: { ADMIN_API_TOKEN: preserve(), ADMIN_ORIGIN: preserve(), FORCE_RESTART: preserve(), GEMINI_API_KEY: preserve(), GEMINI_MODEL: preserve(), LLM_PROVIDER: preserve(), LOG_LEVEL: preserve(), META_APP_ID: preserve(), META_APP_SECRET: preserve(), META_DEFAULT_PHONE_NUMBER_ID: preserve(), META_GRAPH_API_VERSION: preserve(), META_SYSTEM_USER_TOKEN: preserve(), META_WEBHOOK_VERIFY_TOKEN: preserve(), NODE_ENV: preserve(), PRODUCT_NAME: preserve(), SERVICE_HMAC_SECRET: preserve(), STORAGE_BUCKET_CATALOG_IMPORTS: preserve(), STORAGE_BUCKET_INBOUND_MEDIA: preserve(), STORAGE_BUCKET_ORDER_SLIPS: preserve(), STORAGE_BUCKET_PAYMENT_SCREENSHOTS: preserve(), STORAGE_BUCKET_PRODUCT_IMAGES: preserve(), SUPABASE_ANON_KEY: preserve(), SUPABASE_SERVICE_ROLE_KEY: preserve(), SUPABASE_URL: preserve(), TOKEN_ENCRYPTION_KEY: preserve(), WEBHOOK_MAX_BODY_BYTES: preserve() },
  });
  const _appadmin = service("@app/admin", {
    source: sahulatcart_app,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "admin/Dockerfile", watchPatterns: ["/admin/**"] },
    start: "npm run start -w @app/admin",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "appadmin" },
    env: { BACKEND_URL: preserve(), NEXT_PUBLIC_PRODUCT_NAME: preserve() },
  });

  return project("exemplary-charm", {
    resources: [site, _appbackend, _appadmin],
  });
});
