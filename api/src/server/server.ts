import http from "http";
import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import path from "path";
import { ShortCreator } from "../short-creator/ShortCreator";
import { AdCreator } from "../ad-creator/AdCreator";
import { TenantStore } from "../auth/TenantStore";
import { OAuthStore } from "../auth/oauth/OAuthStore";
import { OAuthRouter } from "../auth/oauth/router";
import { authenticate, AuthOptions } from "../auth/middleware";
import { APIRouter } from "./routers/rest";
import { MCPRouter } from "./routers/mcp";
import { AdminRouter } from "./routers/admin";
import { logger } from "../logger";
import { Config } from "../config";

export class Server {
  private app: express.Application;
  private config: Config;

  constructor(config: Config, shortCreator: ShortCreator) {
    this.config = config;
    this.app = express();

    const store = new TenantStore(config.getDataDirPath());
    if (config.adminApiKey) {
      store.ensureAdmin(config.adminApiKey);
    }
    const oauth = new OAuthStore(config.getDataDirPath());
    // Shared auth options: accept OAuth bearer tokens everywhere and advertise
    // the OAuth discovery document on 401s so MCP clients can self-configure.
    const authOpts: AuthOptions = {
      oauth,
      resourceMetadataUrl: `${config.publicUrl}/.well-known/oauth-protected-resource`,
    };
    const adCreator = new AdCreator(shortCreator);

    if (config.authEnabled) {
      logger.info("Auth is ENABLED (multi-tenant subscription mode)");
    } else {
      logger.warn(
        "Auth is DISABLED — all requests run as a local admin tenant. Set AUTH_ENABLED=true and ADMIN_API_KEY to run as a service.",
      );
    }

    // add healthcheck endpoint (public, unauthenticated)
    this.app.get("/health", (req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json({ status: "ok" });
    });

    const apiRouter = new APIRouter(
      config,
      shortCreator,
      adCreator,
      store,
      config.authEnabled,
      authOpts,
    );
    const mcpRouter = new MCPRouter(
      shortCreator,
      adCreator,
      store,
      config.authEnabled,
      authOpts,
    );
    const adminRouter = new AdminRouter(store);
    const oauthRouter = new OAuthRouter(oauth, store, config.publicUrl);

    // OAuth authorization server + discovery metadata (mounted at root so the
    // /.well-known/* endpoints resolve where clients expect them).
    this.app.use("/", oauthRouter.router);

    // Admin provisioning API — authenticated, then admin-gated inside the router.
    this.app.use(
      "/api/admin",
      express.json(),
      authenticate(store, config.authEnabled, authOpts),
      adminRouter.router,
    );
    this.app.use("/api", apiRouter.router);
    this.app.use("/mcp", mcpRouter.router);

    // Serve static files from the UI build
    this.app.use(express.static(path.join(__dirname, "../../dist/ui")));
    this.app.use(
      "/static",
      express.static(path.join(__dirname, "../../static")),
    );

    // Serve the React app for all other routes (must be last)
    this.app.get("*", (req: ExpressRequest, res: ExpressResponse) => {
      res.sendFile(path.join(__dirname, "../../dist/ui/index.html"));
    });
  }

  public start(): http.Server {
    const server = this.app.listen(this.config.port, () => {
      logger.info(
        { port: this.config.port, mcp: "/mcp", api: "/api" },
        "MCP and API server is running",
      );
      logger.info(
        `UI server is running on http://localhost:${this.config.port}`,
      );
    });

    server.on("error", (error: Error) => {
      logger.error(error, "Error starting server");
    });

    return server;
  }

  public getApp() {
    return this.app;
  }
}
