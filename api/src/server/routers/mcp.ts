import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import z from "zod";

import { ShortCreator } from "../../short-creator/ShortCreator";
import { AdCreator } from "../../ad-creator/AdCreator";
import { listPlatforms } from "../../ad-creator/platforms";
import { TenantStore } from "../../auth/TenantStore";
import { authenticate, AuthOptions } from "../../auth/middleware";
import { planFor, Tenant } from "../../auth/types";
import { logger } from "../../logger";
import { renderConfig, sceneInput } from "../../types/shorts";
import { adBriefInput } from "../../types/ads";

/**
 * MCP server exposed over two transports:
 *   - Streamable HTTP at POST/GET/DELETE `/mcp` (the current spec; this is what
 *     Claude's connectors use after OAuth to open the session + list tools).
 *   - Legacy SSE at GET `/mcp/sse` + POST `/mcp/messages` (kept for older
 *     clients).
 *
 * Unlike the original single global server, each connection gets its own
 * McpServer whose tools are bound to the authenticated tenant. This gives us
 * real multi-tenant isolation: a tenant can only see and act on their own
 * videos, and every render is metered against their plan.
 */
export class MCPRouter {
  public router: express.Router;
  private transports: {
    [sessionId: string]: { transport: SSEServerTransport; tenantId: string };
  } = {};
  private streamableTransports: {
    [sessionId: string]: {
      transport: StreamableHTTPServerTransport;
      tenantId: string;
    };
  } = {};

  constructor(
    private shortCreator: ShortCreator,
    private adCreator: AdCreator,
    private store: TenantStore,
    private authEnabled: boolean,
    authOpts: AuthOptions = {},
  ) {
    this.router = express.Router();
    // Authenticate both the SSE handshake and the message channel.
    this.router.use(authenticate(store, authEnabled, authOpts));
    this.setupRoutes();
  }

  /** Build a per-connection MCP server whose tools act as `tenant`. */
  private buildServer(tenant: Tenant): McpServer {
    const server = new McpServer({
      name: "Ad & Short Video Creator",
      version: "1.0.0",
      capabilities: { resources: {}, tools: {} },
    });

    const checkQuotaOrThrow = () => {
      const plan = planFor(tenant);
      if (plan.monthlyVideoQuota === -1) return;
      const usage = this.store.getUsage(tenant.id);
      if (usage.count >= plan.monthlyVideoQuota) {
        throw new Error(
          `Monthly quota of ${plan.monthlyVideoQuota} videos reached on the ${plan.name} plan.`,
        );
      }
    };

    const meter = (videoId: string) => {
      this.store.setOwner(videoId, tenant.id);
      this.store.incrementUsage(tenant.id);
    };

    server.tool(
      "get-video-status",
      "Get the status of a video (ready, processing, failed)",
      { videoId: z.string().describe("The ID of the video") },
      async ({ videoId }) => {
        if (!tenant.isAdmin && !this.store.isOwner(videoId, tenant.id)) {
          return {
            content: [{ type: "text", text: "not found" }],
          };
        }
        return {
          content: [
            { type: "text", text: this.shortCreator.status(videoId) },
          ],
        };
      },
    );

    server.tool(
      "list-ad-platforms",
      "List the supported ad platforms and their delivery specs (aspect ratio, max duration, caption safe zones)",
      {},
      async () => ({
        content: [
          { type: "text", text: JSON.stringify(listPlatforms(), null, 2) },
        ],
      }),
    );

    server.tool(
      "create-ad",
      "Create a short-form video AD for a platform (meta, tiktok, youtube_shorts, youtube, ...) from a product brief. Returns a videoId to poll with get-video-status.",
      adBriefInput.shape,
      async (brief) => {
        checkQuotaOrThrow();
        const videoId = this.adCreator.createAd(brief);
        meter(videoId);
        return { content: [{ type: "text", text: videoId }] };
      },
    );

    server.tool(
      "create-short-video",
      "Create a generic short video from a list of scenes (no ad templating). Returns a videoId.",
      {
        scenes: z.array(sceneInput).describe("Each scene to be created"),
        config: renderConfig.describe("Configuration for rendering the video"),
      },
      async ({ scenes, config }) => {
        checkQuotaOrThrow();
        const videoId = this.shortCreator.addToQueue(scenes, config);
        meter(videoId);
        return { content: [{ type: "text", text: videoId }] };
      },
    );

    return server;
  }

  private setupRoutes() {
    // ---- Streamable HTTP transport (current MCP spec) ----
    // POST /mcp: initialize a session or dispatch a message on an existing one.
    this.router.post(
      "/",
      express.json(),
      async (req: ExpressRequest, res: ExpressResponse) => {
        const tenant = req.tenant!;
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let entry = sessionId
          ? this.streamableTransports[sessionId]
          : undefined;

        if (entry) {
          if (this.authEnabled && entry.tenantId !== tenant.id) {
            res.status(403).json(
              jsonRpcError("Session does not belong to this credential"),
            );
            return;
          }
        } else if (!sessionId && isInitializeRequest(req.body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              this.streamableTransports[sid] = { transport, tenantId: tenant.id };
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) {
              delete this.streamableTransports[transport.sessionId];
            }
          };
          const server = this.buildServer(tenant);
          await server.connect(transport);
          logger.info({ tenantId: tenant.id }, "MCP streamable session opened");
          entry = { transport, tenantId: tenant.id };
        } else {
          res
            .status(400)
            .json(jsonRpcError("No valid session ID for a non-init request"));
          return;
        }
        await entry.transport.handleRequest(req, res, req.body);
      },
    );

    // GET /mcp: server->client SSE stream. DELETE /mcp: end the session.
    const handleStreamableSession = async (
      req: ExpressRequest,
      res: ExpressResponse,
    ) => {
      const tenant = req.tenant!;
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const entry = sessionId ? this.streamableTransports[sessionId] : undefined;
      if (!entry) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      if (this.authEnabled && entry.tenantId !== tenant.id) {
        res.status(403).send("Session does not belong to this credential");
        return;
      }
      await entry.transport.handleRequest(req, res);
    };
    this.router.get("/", handleStreamableSession);
    this.router.delete("/", handleStreamableSession);

    // ---- Legacy SSE transport ----
    this.router.get("/sse", async (req: ExpressRequest, res: ExpressResponse) => {
      const tenant = req.tenant!;
      logger.info({ tenantId: tenant.id }, "MCP SSE connection opened");

      const server = this.buildServer(tenant);
      const transport = new SSEServerTransport("/mcp/messages", res);
      this.transports[transport.sessionId] = {
        transport,
        tenantId: tenant.id,
      };
      res.on("close", () => {
        delete this.transports[transport.sessionId];
      });
      await server.connect(transport);
    });

    this.router.post(
      "/messages",
      async (req: ExpressRequest, res: ExpressResponse) => {
        const sessionId = req.query.sessionId as string;
        const entry = this.transports[sessionId];
        if (!entry) {
          res.status(400).send("No transport found for sessionId");
          return;
        }
        // The message must come from the same tenant that opened the session.
        if (this.authEnabled && req.tenant?.id !== entry.tenantId) {
          res.status(403).send("Session does not belong to this API key");
          return;
        }
        await entry.transport.handlePostMessage(req, res);
      },
    );
  }
}

/** Build a JSON-RPC 2.0 error envelope for Streamable HTTP responses. */
function jsonRpcError(message: string) {
  return {
    jsonrpc: "2.0" as const,
    error: { code: -32000, message },
    id: null,
  };
}
