import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const sahulatcart_app = github("sahulatcart/sahulatcart_app", { checkSuites: false });
  // Both apps build from shared/ and the root workspace files, not only their own folder. With just
  // "/backend/**" a shared/-only or lockfile-only push redeployed nothing and the old build kept serving.
  const workspace = ["/shared/**", "/package.json", "/package-lock.json", "/tsconfig.base.json"];

  const site = service("site", {
    source: sahulatcart_app,
    build: { builder: "DOCKERFILE", dockerfilePath: "site/Dockerfile", watchPatterns: ["/site/**"] },
    start: "nginx -g 'daemon off;'",
    replicas: { "sfo": 1 },
  });
  const _appbackend = service("@app/backend", {
    source: sahulatcart_app,
    build: { buildCommand: "npm run build --workspace=@app/backend", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/backend/**", ...workspace] },
    start: "node backend/dist/index.js",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "appbackend" },
    // NODE_ENV is "production". NPM_CONFIG_INCLUDE="dev" keeps devDependencies (TypeScript) installed
    // for the build; without it npm skips them and every deploy fails with "tsc: command not found".
    env: { ADMIN_API_TOKEN: preserve(), ADMIN_ORIGIN: preserve(), ALERT_EMAIL_FROM: preserve(), FORCE_RESTART: preserve(), GEMINI_API_KEY: preserve(), GEMINI_MODEL: preserve(), LLM_PROVIDER: preserve(), LOG_LEVEL: preserve(), META_APP_ID: preserve(), META_APP_SECRET: preserve(), META_DEFAULT_PHONE_NUMBER_ID: preserve(), META_GRAPH_API_VERSION: preserve(), META_SYSTEM_USER_TOKEN: preserve(), META_WEBHOOK_VERIFY_TOKEN: preserve(), NODE_ENV: preserve(), NPM_CONFIG_INCLUDE: preserve(), PRODUCT_NAME: preserve(), RESEND_API_KEY: preserve(), SERVICE_HMAC_SECRET: preserve(), SIGNUP_ALLOWLIST: preserve(), SIGNUP_OPEN: preserve(), STORAGE_BUCKET_CATALOG_IMPORTS: preserve(), STORAGE_BUCKET_INBOUND_MEDIA: preserve(), STORAGE_BUCKET_ORDER_SLIPS: preserve(), STORAGE_BUCKET_PAYMENT_SCREENSHOTS: preserve(), STORAGE_BUCKET_PRODUCT_IMAGES: preserve(), SUPABASE_ANON_KEY: preserve(), SUPABASE_SERVICE_ROLE_KEY: preserve(), SUPABASE_URL: preserve(), TOKEN_ENCRYPTION_KEY: preserve(), VAPID_PRIVATE_KEY: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPID_SUBJECT: preserve(), WEBHOOK_MAX_BODY_BYTES: preserve() },
  });
  const _appadmin = service("@app/admin", {
    source: sahulatcart_app,
    build: { buildCommand: "echo docker-build", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "admin/Dockerfile", watchPatterns: ["/admin/**", ...workspace, "/.dockerignore"] }, // the Dockerfile copies the whole repo
    start: "npm run start -w @app/admin",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "appadmin" },
    // FIX: purpose unknown (not in the code). Kept as-is until the owner decides; undeclared, an apply deletes it.
    env: { BACKEND_URL: preserve(), FIX: preserve(), NEXT_PUBLIC_PRODUCT_NAME: preserve() },
  });

  return project("exemplary-charm", {
    resources: [site, _appbackend, _appadmin],
  });
});
