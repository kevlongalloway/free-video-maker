import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import fs from "fs-extra";
import path from "path";

import { validateCreateShortInput } from "../validator";
import { ShortCreator } from "../../short-creator/ShortCreator";
import { AdCreator } from "../../ad-creator/AdCreator";
import { listPlatforms, listFormats } from "../../ad-creator/platforms";
import { adBriefInput } from "../../types/ads";
import { TenantStore } from "../../auth/TenantStore";
import { authenticate, enforceQuota, AuthOptions } from "../../auth/middleware";
import { logger } from "../../logger";
import { Config } from "../../config";

// todo abstract class
export class APIRouter {
  public router: express.Router;
  private shortCreator: ShortCreator;
  private adCreator: AdCreator;
  private store: TenantStore;
  private config: Config;

  constructor(
    config: Config,
    shortCreator: ShortCreator,
    adCreator: AdCreator,
    store: TenantStore,
    authEnabled: boolean,
    authOpts: AuthOptions = {},
  ) {
    this.config = config;
    this.router = express.Router();
    this.shortCreator = shortCreator;
    this.adCreator = adCreator;
    this.store = store;

    this.router.use(express.json());
    // Every /api route is authenticated. When auth is disabled the middleware
    // injects a local admin tenant so nothing downstream needs to branch.
    this.router.use(authenticate(store, authEnabled, authOpts));

    this.setupRoutes();
  }

  /** Guard: is the current tenant allowed to touch this video? */
  private ownsVideo(req: ExpressRequest, videoId: string): boolean {
    const tenant = req.tenant;
    if (!tenant) return false;
    if (tenant.isAdmin) return true;
    return this.store.isOwner(videoId, tenant.id);
  }

  private setupRoutes() {
    // ----- generic short video (kept for backward compatibility) -----
    this.router.post(
      "/short-video",
      enforceQuota(this.store),
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const input = validateCreateShortInput(req.body);

          logger.info({ input }, "Creating short video");

          const videoId = this.shortCreator.addToQueue(
            input.scenes,
            input.config,
          );
          this.recordCreation(req, videoId);

          res.status(201).json({
            videoId,
          });
        } catch (error: unknown) {
          logger.error(error, "Error validating input");

          if (error instanceof Error && error.message.startsWith("{")) {
            try {
              const errorData = JSON.parse(error.message);
              res.status(400).json({
                error: "Validation failed",
                message: errorData.message,
                missingFields: errorData.missingFields,
              });
              return;
            } catch (parseError: unknown) {
              logger.error(parseError, "Error parsing validation error");
            }
          }

          res.status(400).json({
            error: "Invalid input",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    // ----- ad layer -----
    // List the supported ad platforms (Meta, TikTok, YouTube, ...).
    this.router.get(
      "/ad-platforms",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json({ platforms: listPlatforms() });
      },
    );

    // List the ad narrative formats (ugc, testimonial, promo, ...).
    this.router.get(
      "/ad-formats",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json({
          formats: listFormats().map((f) => ({
            format: f.format,
            defaultMusic: f.defaultMusic,
          })),
        });
      },
    );

    // Preview how a brief expands into scenes without spending quota.
    this.router.post(
      "/ads/preview",
      (req: ExpressRequest, res: ExpressResponse) => {
        const parsed = adBriefInput.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid ad brief",
            issues: parsed.error.errors,
          });
          return;
        }
        res.status(200).json(this.adCreator.compose(parsed.data));
      },
    );

    // Create an ad. Counts against the tenant's monthly quota.
    this.router.post(
      "/ads",
      enforceQuota(this.store),
      (req: ExpressRequest, res: ExpressResponse) => {
        const parsed = adBriefInput.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid ad brief",
            issues: parsed.error.errors,
          });
          return;
        }
        try {
          const videoId = this.adCreator.createAd(parsed.data);
          this.recordCreation(req, videoId);
          res.status(201).json({ videoId });
        } catch (error: unknown) {
          logger.error(error, "Error creating ad");
          res.status(500).json({
            error: "Failed to create ad",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    // ----- status / listing / retrieval (ownership-scoped) -----
    this.router.get(
      "/short-video/:videoId/status",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({ error: "videoId is required" });
          return;
        }
        if (!this.ownsVideo(req, videoId)) {
          res.status(404).json({ error: "Video not found" });
          return;
        }
        const status = this.shortCreator.status(videoId);
        res.status(200).json({ status });
      },
    );

    this.router.get(
      "/music-tags",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json(this.shortCreator.ListAvailableMusicTags());
      },
    );

    this.router.get("/voices", (_req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json(this.shortCreator.ListAvailableVoices());
    });

    // Usage/quota for the current tenant (handy for the customer dashboard).
    this.router.get("/usage", (req: ExpressRequest, res: ExpressResponse) => {
      const tenant = req.tenant!;
      const usage = this.store.getUsage(tenant.id);
      res.status(200).json({
        tenantId: tenant.id,
        plan: tenant.plan,
        period: usage.period,
        used: usage.count,
      });
    });

    this.router.get(
      "/short-videos",
      (req: ExpressRequest, res: ExpressResponse) => {
        const tenant = req.tenant!;
        const all = this.shortCreator.listAllVideos();
        const videos = tenant.isAdmin
          ? all
          : all.filter((v) => this.store.isOwner(v.id, tenant.id));
        res.status(200).json({ videos });
      },
    );

    this.router.delete(
      "/short-video/:videoId",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({ error: "videoId is required" });
          return;
        }
        if (!this.ownsVideo(req, videoId)) {
          res.status(404).json({ error: "Video not found" });
          return;
        }
        this.shortCreator.deleteVideo(videoId);
        this.store.removeOwnership(videoId);
        res.status(200).json({ success: true });
      },
    );

    // Internal media used by the renderer — not tenant-scoped (opaque temp ids).
    this.router.get(
      "/tmp/:tmpFile",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { tmpFile } = req.params;
        if (!tmpFile) {
          res.status(400).json({ error: "tmpFile is required" });
          return;
        }
        const tmpFilePath = path.join(this.config.tempDirPath, tmpFile);
        if (!fs.existsSync(tmpFilePath)) {
          res.status(404).json({ error: "tmpFile not found" });
          return;
        }

        if (tmpFile.endsWith(".mp3")) {
          res.setHeader("Content-Type", "audio/mpeg");
        }
        if (tmpFile.endsWith(".wav")) {
          res.setHeader("Content-Type", "audio/wav");
        }
        if (tmpFile.endsWith(".mp4")) {
          res.setHeader("Content-Type", "video/mp4");
        }

        const tmpFileStream = fs.createReadStream(tmpFilePath);
        tmpFileStream.on("error", (error) => {
          logger.error(error, "Error reading tmp file");
          res.status(500).json({ error: "Error reading tmp file", tmpFile });
        });
        tmpFileStream.pipe(res);
      },
    );

    this.router.get(
      "/music/:fileName",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { fileName } = req.params;
        if (!fileName) {
          res.status(400).json({ error: "fileName is required" });
          return;
        }
        const musicFilePath = path.join(this.config.musicDirPath, fileName);
        if (!fs.existsSync(musicFilePath)) {
          res.status(404).json({ error: "music file not found" });
          return;
        }
        const musicFileStream = fs.createReadStream(musicFilePath);
        musicFileStream.on("error", (error) => {
          logger.error(error, "Error reading music file");
          res.status(500).json({ error: "Error reading music file", fileName });
        });
        musicFileStream.pipe(res);
      },
    );

    this.router.get(
      "/short-video/:videoId",
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId) {
            res.status(400).json({ error: "videoId is required" });
            return;
          }
          if (!this.ownsVideo(req, videoId)) {
            res.status(404).json({ error: "Video not found" });
            return;
          }
          const video = this.shortCreator.getVideo(videoId);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader(
            "Content-Disposition",
            `inline; filename=${videoId}.mp4`,
          );
          res.send(video);
        } catch (error: unknown) {
          logger.error(error, "Error getting video");
          res.status(404).json({ error: "Video not found" });
        }
      },
    );
  }

  /** Record ownership + count the render against the tenant's quota. */
  private recordCreation(req: ExpressRequest, videoId: string) {
    const tenant = req.tenant;
    if (!tenant) return;
    this.store.setOwner(videoId, tenant.id);
    this.store.incrementUsage(tenant.id);
  }
}
