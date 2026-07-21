import {
  AdPlatformEnum,
  AdFormatEnum,
  PlatformSpec,
  FormatSpec,
} from "../types/ads";
import {
  OrientationEnum,
  CaptionPositionEnum,
  MusicMoodEnum,
} from "../types/shorts";

/**
 * Per-platform delivery specs. Captions are kept clear of each app's
 * on-screen furniture (TikTok's right rail, Reels' bottom UI, etc.).
 */
export const PLATFORM_SPECS: Record<AdPlatformEnum, PlatformSpec> = {
  [AdPlatformEnum.meta]: {
    platform: AdPlatformEnum.meta,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 60,
    recommendedDurationSeconds: 20,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes:
      "Meta Reels/Stories. Hook in the first 3s, keep captions centered to survive feed cropping.",
  },
  [AdPlatformEnum.facebook]: {
    platform: AdPlatformEnum.facebook,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 60,
    recommendedDurationSeconds: 20,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes: "Facebook Reels. Sound-off friendly captions are essential.",
  },
  [AdPlatformEnum.instagram]: {
    platform: AdPlatformEnum.instagram,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 90,
    recommendedDurationSeconds: 20,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes: "Instagram Reels. Keep key content out of the bottom ~15%.",
  },
  [AdPlatformEnum.instagram_reels]: {
    platform: AdPlatformEnum.instagram_reels,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 90,
    recommendedDurationSeconds: 20,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes: "Instagram Reels. Keep key content out of the bottom ~15%.",
  },
  [AdPlatformEnum.tiktok]: {
    platform: AdPlatformEnum.tiktok,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 60,
    recommendedDurationSeconds: 25,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes:
      "TikTok. Right-side action rail + bottom caption bar; keep text centered and away from edges.",
  },
  [AdPlatformEnum.snapchat]: {
    platform: AdPlatformEnum.snapchat,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 60,
    recommendedDurationSeconds: 15,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes: "Snapchat. Very short attention window, front-load the hook.",
  },
  [AdPlatformEnum.youtube_shorts]: {
    platform: AdPlatformEnum.youtube_shorts,
    orientation: OrientationEnum.portrait,
    aspectRatio: "9:16",
    maxDurationSeconds: 60,
    recommendedDurationSeconds: 30,
    safeCaptionPosition: CaptionPositionEnum.center,
    notes: "YouTube Shorts. Bottom is covered by title/CTA chrome.",
  },
  [AdPlatformEnum.youtube]: {
    platform: AdPlatformEnum.youtube,
    orientation: OrientationEnum.landscape,
    aspectRatio: "16:9",
    maxDurationSeconds: 30,
    recommendedDurationSeconds: 15,
    safeCaptionPosition: CaptionPositionEnum.bottom,
    notes:
      "YouTube in-stream (pre/mid-roll). 16:9. Get the brand in before the skip button at 5s.",
  },
};

export const FORMAT_SPECS: Record<AdFormatEnum, FormatSpec> = {
  [AdFormatEnum.ugc]: {
    format: AdFormatEnum.ugc,
    defaultMusic: MusicMoodEnum.happy,
    hookTemplate: (product, audience) =>
      audience
        ? `Okay ${audience}, you need to hear about ${product}.`
        : `I can't believe I only just found ${product}.`,
    ctaTemplate: (cta) => cta,
  },
  [AdFormatEnum.problem_solution]: {
    format: AdFormatEnum.problem_solution,
    defaultMusic: MusicMoodEnum.hopeful,
    hookTemplate: (product) =>
      `Tired of the same old problem? ${product} fixes it.`,
    ctaTemplate: (cta) => cta,
  },
  [AdFormatEnum.testimonial]: {
    format: AdFormatEnum.testimonial,
    defaultMusic: MusicMoodEnum.contemplative,
    hookTemplate: (product) => `Here's why I switched to ${product}.`,
    ctaTemplate: (cta) => cta,
  },
  [AdFormatEnum.product_showcase]: {
    format: AdFormatEnum.product_showcase,
    defaultMusic: MusicMoodEnum.excited,
    hookTemplate: (product) => `Meet ${product}.`,
    ctaTemplate: (cta) => cta,
  },
  [AdFormatEnum.promo]: {
    format: AdFormatEnum.promo,
    defaultMusic: MusicMoodEnum.euphoric,
    hookTemplate: (product) => `Big news — ${product} is on sale right now.`,
    ctaTemplate: (cta, brand) => (brand ? `${cta} Only at ${brand}.` : cta),
  },
  [AdFormatEnum.explainer]: {
    format: AdFormatEnum.explainer,
    defaultMusic: MusicMoodEnum.chill,
    hookTemplate: (product) => `Here's how ${product} works.`,
    ctaTemplate: (cta) => cta,
  },
};

export function getPlatformSpec(platform: AdPlatformEnum): PlatformSpec {
  return PLATFORM_SPECS[platform];
}

export function getFormatSpec(format: AdFormatEnum): FormatSpec {
  return FORMAT_SPECS[format];
}

export function listPlatforms(): PlatformSpec[] {
  return Object.values(PLATFORM_SPECS);
}

export function listFormats(): FormatSpec[] {
  return Object.values(FORMAT_SPECS);
}
