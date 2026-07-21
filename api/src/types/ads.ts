import z from "zod";

import {
  VoiceEnum,
  MusicMoodEnum,
  CaptionPositionEnum,
  OrientationEnum,
} from "./shorts";

/**
 * The advertising layer sits on top of the generic short-video engine.
 * It turns a marketing "ad brief" (product, hook, benefits, CTA) into the
 * scene/render config the underlying ShortCreator understands, applying
 * platform-specific best practices (aspect ratio, duration, caption safe
 * zones) for Meta, TikTok, YouTube, etc.
 */

export enum AdPlatformEnum {
  // Meta family (Facebook + Instagram Reels/Stories) -> 9:16 portrait
  meta = "meta",
  facebook = "facebook",
  instagram = "instagram",
  instagram_reels = "instagram_reels",
  // TikTok -> 9:16 portrait
  tiktok = "tiktok",
  // Snapchat -> 9:16 portrait
  snapchat = "snapchat",
  // YouTube Shorts -> 9:16 portrait
  youtube_shorts = "youtube_shorts",
  // YouTube in-stream / pre-roll -> 16:9 landscape
  youtube = "youtube",
}

/**
 * The narrative structure of the ad. Each format controls how the brief is
 * expanded into scenes, the default music mood, and pacing.
 */
export enum AdFormatEnum {
  ugc = "ugc", // authentic user-generated-content style
  problem_solution = "problem_solution",
  testimonial = "testimonial",
  product_showcase = "product_showcase",
  promo = "promo", // sale / discount driven
  explainer = "explainer",
}

export interface PlatformSpec {
  platform: AdPlatformEnum;
  orientation: OrientationEnum;
  aspectRatio: string;
  /** hard limit the platform allows for this ad slot, seconds */
  maxDurationSeconds: number;
  /** the sweet-spot duration for performance, seconds */
  recommendedDurationSeconds: number;
  /** keep captions clear of the platform's on-screen UI */
  safeCaptionPosition: CaptionPositionEnum;
  notes: string;
}

export interface FormatSpec {
  format: AdFormatEnum;
  defaultMusic: MusicMoodEnum;
  /** hint used when auto-generating a hook if the brief omits one */
  hookTemplate: (product: string, audience?: string) => string;
  /** how the CTA scene is phrased if only a raw CTA is given */
  ctaTemplate: (cta: string, brand?: string) => string;
}

export const adBriefInput = z.object({
  platform: z
    .nativeEnum(AdPlatformEnum)
    .describe("Target ad platform (meta, tiktok, youtube_shorts, youtube, ...)"),
  format: z
    .nativeEnum(AdFormatEnum)
    .optional()
    .describe(
      "Narrative style of the ad. Defaults to 'ugc'. Controls scene structure, music and pacing.",
    ),
  productName: z.string().describe("Name of the product or service advertised"),
  productDescription: z
    .string()
    .describe("One or two sentences describing what the product does"),
  hook: z
    .string()
    .optional()
    .describe(
      "The opening line (first 1-2 seconds). If omitted, one is generated from the format template.",
    ),
  benefits: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe(
      "Key selling points. Each becomes a middle scene. 2-3 is ideal for short ads.",
    ),
  callToAction: z
    .string()
    .describe("What the viewer should do next, e.g. 'Shop now at acme.com'"),
  brandName: z
    .string()
    .optional()
    .describe("Brand name, used to reinforce the CTA scene"),
  targetAudience: z
    .string()
    .optional()
    .describe("Who the ad speaks to, e.g. 'busy parents'. Sharpens the hook."),
  keywords: z
    .array(z.string())
    .optional()
    .describe(
      "Visual keywords used to source stock B-roll (Pexels). If omitted, they are derived from the product and benefits.",
    ),
  voice: z
    .nativeEnum(VoiceEnum)
    .optional()
    .describe("Voiceover voice. Defaults to a natural narrator."),
  music: z
    .nativeEnum(MusicMoodEnum)
    .optional()
    .describe("Override the music mood. Defaults to the format's mood."),
  captionPosition: z
    .nativeEnum(CaptionPositionEnum)
    .optional()
    .describe("Override caption placement. Defaults to the platform safe zone."),
  captionBackgroundColor: z
    .string()
    .optional()
    .describe("CSS color for the caption highlight background"),
  paddingBackMs: z
    .number()
    .optional()
    .describe("Extra hold time on the last scene, in ms. Default 1500."),
});

export type AdBriefInput = z.infer<typeof adBriefInput>;
