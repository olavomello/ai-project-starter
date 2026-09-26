---
name: photo-generation
description: Route photographic and photorealistic image creation to ChatGPT/OpenAI image generation instead of producing it in Claude. Use this whenever a task needs a photo, photorealistic render, product shot, lifestyle/stock-style image, realistic portrait, hero photo, or "realistic" mockup imagery — even if the user just says "an image of" something that should look like a real photograph. Do NOT use for icons, logos, illustrations, diagrams, charts, SVG, UI mockups, or other non-photographic assets; those stay with the relevant Claude agent.
---

# Photo Generation (routed to ChatGPT)

Photographic/photorealistic images are produced by OpenAI image generation. Everything non-photographic (SVG, icons, illustrations, diagrams, charts, UI, CSS art) is produced by the pertinent Claude agent — don't route those out.

When unsure whether an asset is "photographic": if it should be mistakable for a real camera photo, route it. Otherwise keep it in Claude.

## Workflow

1. **Write the request file** `.agents/media/requests/<slug>.md` using this template — it's the single source of the prompt, so retries and the human fallback use the same spec:

   ```
   slug: <kebab-case>
   use: <where it goes, e.g. landing hero>
   size: 1024x1024 | 1536x1024 | 1024x1536
   prompt: <subject, setting, lighting, lens/camera feel, mood, composition>
   avoid: <text in image, logos, real people's likeness, brand marks>
   output: <target path, e.g. public/img/hero.png>
   ```

2. **Generate:**
   - If `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` are set: `bash <skill>/scripts/gen-photo.sh .agents/media/requests/<slug>.md`
   - Otherwise: stop and tell the user the request file is ready to paste into ChatGPT, and where to save the result. Don't try another provider.

3. **Check the result** by viewing the image once. Accept, or do at most **one** revised retry with a refined prompt. Further attempts need explicit approval — each call costs money on the OpenAI account.

4. **Post-process in Claude** (resize, crop, compress, alt text, integration into code) with normal tools.

5. **Report**: output path, prompt used, attempts made.

## Rules

- No real, identifiable people or trademarks in prompts unless the user supplies rights/assets for it.
- Never write API keys into files, logs, or request files.
- Never change OpenAI or Anthropic billing, credits, or limits.
- `<skill>` = this skill's directory (e.g. `.claude/skills/photo-generation`).
