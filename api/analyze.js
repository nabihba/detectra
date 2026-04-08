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

    // Check image size (base64 is ~33% larger than binary)
    const estimatedSizeBytes = (image.length * 3) / 4;
    if (estimatedSizeBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Maximum 10MB.' });
    }

    // Initialize Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY not configured');
      return res.status(500).json({ error: 'Service misconfigured. Contact the administrator.' });
    }

    const ai = new GoogleGenAI({ apiKey });

    const startTime = Date.now();

    // Send to Gemini for analysis
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
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
      config: {
        responseMimeType: 'application/json',
      },
    });

    const processingTime = Date.now() - startTime;

    // Parse Gemini response
    const rawText = response.text;
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // If JSON parsing fails, try to extract from markdown code blocks
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        console.error('Failed to parse Gemini response:', rawText);
        return res.status(500).json({ error: 'Failed to parse analysis result.' });
      }
    }

    // Normalize the response
    const result = normalizeResult(parsed);
    result.processingTimeMs = processingTime;

    return res.status(200).json(result);
  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({
      error: 'Analysis failed. Please try again.',
    });
  }
}

// ─── Analysis Prompt ───
const ANALYSIS_PROMPT = `You are Detectra, an expert AI-generated image forensics analyzer. Your job is to determine whether an uploaded image is AI-generated or a real photograph.

Analyze the image carefully for these indicators:

**AI-Generated Indicators:**
- Unnatural skin textures, plastic-looking surfaces
- Inconsistent lighting or shadows
- Distorted or extra fingers, hands, teeth
- Background inconsistencies (melting objects, nonsensical architecture)
- Overly smooth or perfect gradients
- Repetitive patterns or textures
- Text that is garbled or nonsensical
- Unnatural eye reflections or asymmetry
- Seamless, overly polished aesthetic typical of AI generation
- Artifacts around hair, ears, or object boundaries

**Authentic Image Indicators:**
- Natural noise and grain patterns consistent with camera sensors
- Consistent lighting and physics
- Natural imperfections (skin pores, fabric wrinkles, dust)
- Proper perspective and depth of field
- EXIF-like characteristics (lens distortion, chromatic aberration)
- Authentic motion blur patterns
- Natural color distribution

Respond ONLY with a JSON object in this exact format:
{
  "verdict": "FAKE" or "REAL" or "UNCERTAIN",
  "confidence": 0.0 to 1.0,
  "analysis": "A 2-3 sentence explanation of your reasoning, mentioning specific artifacts or authentic features you identified."
}

Rules:
- If confidence is below 0.55, set verdict to "UNCERTAIN"
- Be honest. If you're not sure, say UNCERTAIN
- The analysis field should be conversational and specific to this exact image
- Do NOT mention that you are an AI or that you are guessing`;

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
