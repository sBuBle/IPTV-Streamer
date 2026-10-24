import { z } from "zod";

/** Subset of the Stremio add-on protocol, used to validate our responses in tests. */
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md

const extraSchema = z.object({
  name: z.string(),
  isRequired: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  optionsLimit: z.number().optional(),
});

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9.\-_]+$/i),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  name: z.string().min(1),
  description: z.string().min(1),
  resources: z.array(z.union([z.string(), z.object({ name: z.string(), types: z.array(z.string()), idPrefixes: z.array(z.string()).optional() })])),
  types: z.array(z.string()).min(1),
  idPrefixes: z.array(z.string()).optional(),
  catalogs: z.array(z.object({ type: z.string(), id: z.string(), name: z.string(), extra: z.array(extraSchema).optional() })),
  logo: z.string().optional(),
  background: z.string().optional(),
  behaviorHints: z.object({ configurable: z.boolean().optional(), adult: z.boolean().optional(), p2p: z.boolean().optional() }).optional(),
});

export const metaPreviewSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().min(1),
  poster: z.string().optional(),
  posterShape: z.enum(["square", "poster", "landscape"]).optional(),
  description: z.string().optional(),
  genres: z.array(z.string()).optional(),
});

export const metaSchema = metaPreviewSchema.extend({
  logo: z.string().optional(),
  background: z.string().optional(),
  language: z.string().optional(),
  website: z.string().optional(),
});

export const streamSchema = z
  .object({
    url: z.url().optional(),
    ytId: z.string().optional(),
    externalUrl: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    behaviorHints: z
      .object({
        notWebReady: z.boolean().optional(),
        bingeGroup: z.string().optional(),
        proxyHeaders: z.object({ request: z.record(z.string(), z.string()).optional(), response: z.record(z.string(), z.string()).optional() }).optional(),
      })
      .optional(),
  })
  .refine((s) => !!(s.url || s.ytId || s.externalUrl), "stream needs url, ytId or externalUrl");

export const catalogResponseSchema = z.object({ metas: z.array(metaPreviewSchema) });
export const metaResponseSchema = z.object({ meta: metaSchema });
export const streamResponseSchema = z.object({ streams: z.array(streamSchema) });

export type Manifest = z.infer<typeof manifestSchema>;
export type MetaPreview = z.infer<typeof metaPreviewSchema>;
export type Meta = z.infer<typeof metaSchema>;
export type Stream = z.infer<typeof streamSchema>;
