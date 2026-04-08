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
    });

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
const ANALYSIS_PROMPT = `You are an expert AI-generated image forensics analyzer. Determine whether this image is AI-generated or a real photograph.

Analyze for these indicators:

AI-Generated clues: unnatural skin textures, inconsistent lighting/shadows, distorted fingers/hands/teeth, background inconsistencies, overly smooth gradients, garbled text, unnatural eye reflections, artifacts around hair/ears/boundaries.

Authentic clues: natural noise/grain, consistent lighting and physics, natural imperfections, proper perspective/depth of field, authentic motion blur, natural color distribution.

You MUST respond with ONLY a valid JSON object (no markdown, no code blocks, no extra text) in this exact format:
{"verdict": "FAKE", "confidence": 0.85, "analysis": "Your 2-3 sentence explanation here."}

Rules:
- verdict must be exactly "FAKE" or "REAL" or "UNCERTAIN"
- confidence must be a number between 0.0 and 1.0
- If confidence is below 0.55, set verdict to "UNCERTAIN"
- The analysis should mention specific artifacts or features you found in this image
- Respond with ONLY the JSON object, nothing else`;

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
