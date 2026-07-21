import { ShortCreator } from "../short-creator/ShortCreator";
import { logger } from "../logger";
import {
  AdBriefInput,
  AdFormatEnum,
  PlatformSpec,
} from "../types/ads";
import {
  SceneInput,
  RenderConfig,
  MusicVolumeEnum,
} from "../types/shorts";
import { getPlatformSpec, getFormatSpec } from "./platforms";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "your",
  "you",
  "our",
  "to",
  "of",
  "in",
  "on",
  "is",
  "it",
  "that",
  "this",
  "at",
  "now",
  "get",
  "best",
  "new",
]);

/**
 * The AdCreator is the marketing wrapper around the generic ShortCreator.
 * It does not render anything itself: it translates a high-level ad brief
 * into the (scenes, renderConfig) tuple the engine already knows how to
 * produce, applying platform + format conventions along the way.
 */
export class AdCreator {
  constructor(private shortCreator: ShortCreator) {}

  /**
   * Build the ad and enqueue it for rendering. Returns the video id that can
   * be polled / downloaded through the same endpoints as any other video.
   */
  public createAd(brief: AdBriefInput): string {
    const { scenes, config } = this.compose(brief);
    logger.info(
      { platform: brief.platform, format: brief.format, scenes: scenes.length },
      "Enqueuing ad",
    );
    return this.shortCreator.addToQueue(scenes, config);
  }

  /** Expose the composition for previewing / testing without rendering. */
  public compose(brief: AdBriefInput): {
    scenes: SceneInput[];
    config: RenderConfig;
  } {
    const platformSpec = getPlatformSpec(brief.platform);
    const format = brief.format ?? AdFormatEnum.ugc;
    const formatSpec = getFormatSpec(format);

    const scenes = this.buildScenes(brief, formatSpec);
    const config = this.buildConfig(brief, platformSpec, format);
    return { scenes, config };
  }

  private buildScenes(
    brief: AdBriefInput,
    formatSpec: ReturnType<typeof getFormatSpec>,
  ): SceneInput[] {
    const baseKeywords =
      brief.keywords && brief.keywords.length > 0
        ? brief.keywords
        : this.deriveKeywords(brief.productName, brief.productDescription);

    const scenes: SceneInput[] = [];

    // 1. Hook scene — the first 1-3 seconds that stop the scroll.
    const hook =
      brief.hook ?? formatSpec.hookTemplate(brief.productName, brief.targetAudience);
    scenes.push({
      text: hook,
      searchTerms: this.pickSearchTerms(baseKeywords, [brief.productName]),
    });

    // 2. Benefit scenes — one per selling point.
    for (const benefit of brief.benefits) {
      scenes.push({
        text: benefit,
        searchTerms: this.pickSearchTerms(
          this.deriveKeywords(benefit),
          baseKeywords,
        ),
      });
    }

    // 3. CTA scene — always last, reinforces the brand + action.
    const cta = formatSpec.ctaTemplate(brief.callToAction, brief.brandName);
    scenes.push({
      text: cta,
      searchTerms: this.pickSearchTerms(baseKeywords, [
        brief.brandName ?? brief.productName,
      ]),
    });

    return scenes;
  }

  private buildConfig(
    brief: AdBriefInput,
    platformSpec: PlatformSpec,
    format: AdFormatEnum,
  ): RenderConfig {
    const formatSpec = getFormatSpec(format);
    return {
      orientation: platformSpec.orientation,
      captionPosition: brief.captionPosition ?? platformSpec.safeCaptionPosition,
      captionBackgroundColor: brief.captionBackgroundColor,
      voice: brief.voice,
      music: brief.music ?? formatSpec.defaultMusic,
      // Ads live or die on the voiceover being intelligible — keep music low.
      musicVolume: MusicVolumeEnum.low,
      paddingBack: brief.paddingBackMs ?? 1500,
    };
  }

  /** Turn free text into 2-3 lowercase visual search keywords. */
  private deriveKeywords(...texts: string[]): string[] {
    const words = texts
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    const unique: string[] = [];
    for (const w of words) {
      if (!unique.includes(w)) unique.push(w);
      if (unique.length >= 3) break;
    }
    return unique;
  }

  /**
   * Pexels needs at least a couple of search terms per scene (it falls back
   * to joker terms otherwise). Prefer the scene-specific keywords, then top
   * up with fallbacks so every scene always has >= 2 terms.
   */
  private pickSearchTerms(primary: string[], fallback: string[]): string[] {
    const terms = [...primary];
    for (const f of fallback) {
      const cleaned = f.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
      const firstWord = cleaned.split(/\s+/)[0];
      if (firstWord && firstWord.length > 2 && !terms.includes(firstWord)) {
        terms.push(firstWord);
      }
    }
    while (terms.length < 2) {
      terms.push("lifestyle");
    }
    return terms.slice(0, 4);
  }
}
