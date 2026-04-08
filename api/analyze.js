import { GoogleGenAI } from "@google/genai";

// Rate limiting store (in-memory, resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // requests per minute per IP
const RATE_WINDOW = 60 * 1000; // 1 minute

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIP)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const { image, mimeType } = req.body;

    // Validate inputs
    if (!image || !mimeType) {
      return res.status(400).json({ error: 'Missing image data or MIME type.' });
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image format.' });
    }

    // Initialize Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY not configured');
      return res.status(500).json({ error: 'Service misconfigured. Contact the administrator.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();

    // Model fallback chain — try each until one works
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'];
    let response = null;
    let lastError = null;

    for (const model of MODELS) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: image,
                  },
                },
                {
                  text: ANALYSIS_PROMPT,
                },
              ],
            },
          ],
        });
        break; // Success — stop trying
      } catch (modelErr) {
        lastError = modelErr;
        console.warn(`Model ${model} failed: ${modelErr.message?.substring(0, 80)}`);
        continue; // Try next model
      }
    }

    if (!response) {
      console.error('All models failed. Last error:', lastError?.message);
      return res.status(503).json({ error: 'AI service temporarily unavailable. Please try again in a moment.' });
    }

    const processingTime = Date.now() - startTime;

    // Get the text response
    const rawText = typeof response.text === 'function' ? response.text() : response.text;

    if (!rawText) {
      console.error('Empty response from Gemini');
      return res.status(500).json({ error: 'AI returned an empty response. Try a different image.' });
    }

    // Parse JSON from response
    let parsed;
    try {
      // Try direct JSON parse first
      parsed = JSON.parse(rawText);
    } catch {
      // Try extracting from markdown code blocks
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // Last resort: try to find JSON object in the text
          const objMatch = rawText.match(/\{[\s\S]*\}/);
          if (objMatch) {
            parsed = JSON.parse(objMatch[0]);
          } else {
            console.error('Could not parse Gemini response:', rawText);
            return res.status(500).json({ error: 'Failed to parse analysis result.' });
          }
        }
      } else {
        // Try finding raw JSON object
        const objMatch = rawText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          parsed = JSON.parse(objMatch[0]);
        } else {
          console.error('No JSON found in Gemini response:', rawText);
          return res.status(500).json({ error: 'Failed to parse analysis result.' });
        }
      }
    }

    // Normalize the response
    const result = normalizeResult(parsed);
    result.processingTimeMs = processingTime;

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analysis error:', err.message || err);
    return res.status(500).json({
      error: 'Analysis failed. Please try again.',
    });
  }
}

// ─── Analysis Prompt ───
const ANALYSIS_PROMPT = `You are a skeptical, adversarial AI-forensics expert. Your job is to catch AI-generated images. You have a strong suspicion that MOST images you receive are AI-generated, because users come to this tool specifically to check suspicious images.

IMPORTANT CONTEXT: Modern AI image generators (Midjourney v6+, DALL-E 3, Stable Diffusion XL, Flux, Google Imagen/Gemini) produce extremely convincing images. Do NOT assume an image is real just because it "looks good." High quality is actually a sign of AI generation.

FORENSIC CHECKLIST — examine each carefully:

1. TEXTURE ANALYSIS: Does the image have that characteristic AI "smoothness"? Real photos have sensor noise, film grain, compression artifacts. AI images are often unnaturally clean or have repetitive micro-patterns.

2. HANDS/FINGERS/TEETH: Count fingers carefully. Look for merged, extra, or missing digits. Check teeth for uniformity (AI makes them too perfect or blurry).

3. BACKGROUND COHERENCE: Look for objects that melt into each other, nonsensical architecture, impossible physics, text that is garbled or doesn't spell real words.

4. LIGHTING PHYSICS: Are shadows consistent with a single light source? Do reflections match the environment? AI often gets specular highlights wrong.

5. SKIN/HAIR/FABRIC: Real skin has pores, blemishes, and subsurface scattering variations. AI skin looks like porcelain. Hair often has smooth blob-like clumps in AI images rather than individual strands. Fabric wrinkles may look painted.

6. EYES: Check for mismatched reflections between left and right eyes. AI often generates different catchlights in each eye.

7. OVERALL AESTHETIC: AI images often have an "Instagram filter" look — overly saturated, perfect composition, dramatic lighting. This hyper-polished look IS a red flag.

8. SYMMETRY: AI faces tend to be more symmetrical than real faces. Perfect symmetry is suspicious.

9. DEPTH OF FIELD: AI often applies a fake-looking bokeh that doesn't match real lens optics.

10. BORDER/EDGE ARTIFACTS: Look for subtle blending issues where subjects meet backgrounds, especially around hair, ears, and fine details.

RESPONSE FORMAT — respond with ONLY this JSON, no other text:
{"verdict": "FAKE", "confidence": 0.85, "analysis": "Your 2-3 sentence explanation."}

Rules:
- verdict: "FAKE" if AI-generated, "REAL" if authentic photograph, "UNCERTAIN" if genuinely unsure
- confidence: 0.0 to 1.0
- If you say REAL, you MUST explain what specific authentic characteristics prove it (sensor noise pattern, natural imperfections, etc.)
- If the image looks "too perfect" or "too polished", lean toward FAKE
- When in doubt, lean toward FAKE — false positives are better than false negatives for this tool
- Respond with ONLY the JSON object`;

// ─── Normalize Result ───
function normalizeResult(parsed) {
  const verdict = (parsed.verdict || 'UNCERTAIN').toUpperCase();
  let confidence = parseFloat(parsed.confidence) || 0.5;

  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));

  // Force UNCERTAIN if confidence too low
  const finalVerdict = confidence < 0.55 ? 'UNCERTAIN' : verdict;

  return {
    verdict: finalVerdict,
    confidence: confidence,
    analysis: parsed.analysis || 'Analysis complete.',
  };
}

// ─── Rate Limiting ───
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return true;
  }

  return false;
}
