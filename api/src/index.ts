/* eslint-disable @typescript-eslint/no-unused-vars */
import path from "path";
import fs from "fs-extra";

import { Kokoro } from "./short-creator/libraries/Kokoro";
import { Remotion } from "./short-creator/libraries/Remotion";
import { Whisper } from "./short-creator/libraries/Whisper";
import { FFMpeg } from "./short-creator/libraries/FFmpeg";
import { PexelsAPI } from "./short-creator/libraries/Pexels";
import { Config } from "./config";
import { ShortCreator } from "./short-creator/ShortCreator";
import { logger } from "./logger";
import { Server } from "./server/server";
import { MusicManager } from "./short-creator/music";

async function main() {
  const config = new Config();
  logger.info(
    {
      logLevel: config.logLevel,
      runningInDocker: config.runningInDocker,
      whisperModel: config.whisperModel,
      pexelsApiKeySet: Boolean(config.pexelsApiKey),
    },
    "Starting free-video-maker API",
  );
  try {
    config.ensureConfig();
  } catch (err: unknown) {
    logger.error(err, "Error in config");
    process.exit(1);
  }

  const musicManager = new MusicManager(config);
  try {
    logger.info("checking music files");
    musicManager.ensureMusicFilesExist();
  } catch (error: unknown) {
    logger.error(error, "Missing music files");
    process.exit(1);
  }

  // These init steps load models / binaries and are the most likely place for
  // a worker to crash on startup. Log each at info so a crash-on-boot on
  // Render shows exactly which dependency failed to initialize.
  try {
    logger.info("initializing remotion");
    const remotion = await Remotion.init(config);
    logger.info("initializing kokoro");
    const kokoro = await Kokoro.init(config.kokoroModelPrecision);
    logger.info("initializing whisper");
    const whisper = await Whisper.init(config);
    logger.info("initializing ffmpeg");
    const ffmpeg = await FFMpeg.init();
    const pexelsApi = new PexelsAPI(config.pexelsApiKey);

    await startServer(
      config,
      remotion,
      kokoro,
      whisper,
      ffmpeg,
      pexelsApi,
      musicManager,
    );
  } catch (error: unknown) {
    logger.fatal(error, "Failed to initialize the render worker on startup");
    process.exit(1);
  }
}

async function startServer(
  config: Config,
  remotion: Remotion,
  kokoro: Kokoro,
  whisper: Whisper,
  ffmpeg: FFMpeg,
  pexelsApi: PexelsAPI,
  musicManager: MusicManager,
) {
  logger.info("initializing the short creator");
  const shortCreator = new ShortCreator(
    config,
    remotion,
    kokoro,
    whisper,
    ffmpeg,
    pexelsApi,
    musicManager,
  );

  if (!config.runningInDocker) {
    // the project is running with npm - we need to check if the installation is correct
    if (fs.existsSync(config.installationSuccessfulPath)) {
      logger.info("the installation is successful - starting the server");
    } else {
      logger.info(
        "testing if the installation was successful - this may take a while...",
      );
      try {
        const audioBuffer = (await kokoro.generate("hi", "af_heart")).audio;
        await ffmpeg.createMp3DataUri(audioBuffer);
        await pexelsApi.findVideo(["dog"], 2.4);
        const testVideoPath = path.join(config.tempDirPath, "test.mp4");
        await remotion.testRender(testVideoPath);
        fs.rmSync(testVideoPath, { force: true });
        fs.writeFileSync(config.installationSuccessfulPath, "ok", {
          encoding: "utf-8",
        });
        logger.info("the installation was successful - starting the server");
      } catch (error: unknown) {
        logger.fatal(
          error,
          "The environment is not set up correctly - please follow the instructions in the README.md file https://github.com/gyoridavid/short-video-maker",
        );
        process.exit(1);
      }
    }
  }

  logger.info("initializing the server");
  const server = new Server(config, shortCreator);
  const app = server.start();
  logger.info({ port: config.port }, "Server started");

  // todo add shutdown handler
}

// Last-resort handlers: without these an async throw or rejected promise that
// escapes the render pipeline can take the worker down silently, leaving no
// trace in the Render logs. Log them at fatal so they always surface.
process.on("unhandledRejection", (reason: unknown) => {
  logger.fatal(reason, "Unhandled promise rejection");
});
process.on("uncaughtException", (error: unknown) => {
  logger.fatal(error, "Uncaught exception");
});

main().catch((error: unknown) => {
  logger.error(error, "Error starting server");
  process.exit(1);
});
