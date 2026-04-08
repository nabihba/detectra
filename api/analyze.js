import { GoogleGenAI } from "@google/genai";

// Rate limiting store (in-memory, resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIP)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  try {
    const { image, mimeType } = req.body;

    if (!image || !mimeType) {
      return res.status(400).json({ error: 'Missing image data or MIME type.' });
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({ error: 'Unsupported image format.' });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const hfToken = process.env.HF_TOKEN;

    if (!geminiKey || !hfToken) {
      console.error('Missing env vars:', { gemini: !!geminiKey, hf: !!hfToken });
      return res.status(500).json({ error: 'Service misconfigured.' });
    }

    const startTime = Date.now();

    // Convert base64 to binary buffer for HuggingFace
    const imageBuffer = Buffer.from(image, 'base64');

    // ═══════════════════════════════════════════════════════
    // STEP 1: ML CLASSIFIER — Real detection using trained model
    // Uses Organika/sdxl-detector (98% accuracy, Swin Transformer)
    // Fallback: umm-maybe/AI-image-detector (94% accuracy, ViT)
    // ═══════════════════════════════════════════════════════
    let classifierResult = null;
    const DETECTION_MODELS = ['Organika/sdxl-detector', 'umm-maybe/AI-image-detector'];

    for (const model of DETECTION_MODELS) {
      try {
        const hfResponse = await fetch(
          `https://router.huggingface.co/hf-inference/models/${model}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hfToken}`,
              'Content-Type': 'application/octet-stream',
            },
            body: imageBuffer,
          }
        );

        if (!hfResponse.ok) {
          const errText = await hfResponse.text();
          console.warn(`HF model ${model} returned ${hfResponse.status}: ${errText.substring(0, 100)}`);
          continue;
        }

        const predictions = await hfResponse.json();
        classifierResult = { model, predictions };
        break; // Success
      } catch (hfErr) {
        console.warn(`HF model ${model} failed:`, hfErr.message?.substring(0, 100));
        continue;
      }
    }

    // Parse classifier result
    let verdict = 'UNCERTAIN';
    let confidence = 0.5;

    if (classifierResult && Array.isArray(classifierResult.predictions)) {
      const preds = classifierResult.predictions;
      const artificialScore = preds.find(p =>
        p.label.toLowerCase() === 'artificial' ||
        p.label.toLowerCase() === 'ai' ||
        p.label.toLowerCase() === 'fake'
      )?.score || 0;
      const humanScore = preds.find(p =>
        p.label.toLowerCase() === 'human' ||
        p.label.toLowerCase() === 'real'
      )?.score || 0;

      if (artificialScore > humanScore) {
        verdict = 'FAKE';
        confidence = artificialScore;
      } else {
        verdict = 'REAL';
        confidence = humanScore;
      }

      if (confidence < 0.55) {
        verdict = 'UNCERTAIN';
      }
    } else {
      console.error('No classifier result available');
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: GEMINI EXPLANATION — Human-readable analysis
    // Classifier gives the verdict, Gemini explains WHY
    // ═══════════════════════════════════════════════════════
    let analysis = '';
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

      for (const model of MODELS) {
        try {
          const prompt = verdict === 'FAKE'
            ? EXPLAIN_FAKE_PROMPT
            : verdict === 'REAL'
              ? EXPLAIN_REAL_PROMPT
              : EXPLAIN_UNCERTAIN_PROMPT;

          const geminiResponse = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType, data: image } },
                  { text: prompt },
                ],
              },
            ],
          });

          const rawText = typeof geminiResponse.text === 'function'
            ? geminiResponse.text()
            : geminiResponse.text;

          analysis = rawText?.trim() || '';
          break;
        } catch {
          continue;
        }
      }
    } catch {
      // Gemini explanation is optional
    }

    // Fallback analysis text
    if (!analysis) {
      if (verdict === 'FAKE') {
        analysis = 'Our AI classifier has detected patterns consistent with AI-generated imagery. The image exhibits characteristics typical of synthetic content produced by modern image generation models.';
      } else if (verdict === 'REAL') {
        analysis = 'Our AI classifier has identified characteristics consistent with an authentic photograph, including natural noise patterns and organic imperfections.';
      } else {
        analysis = 'Our AI classifier could not reach a definitive conclusion. The image contains elements that could indicate either authentic or AI-generated content.';
      }
    }

    const processingTime = Date.now() - startTime;

    return res.status(200).json({
      verdict,
      confidence,
      analysis,
      processingTimeMs: processingTime,
      detectionModel: classifierResult?.model || 'none',
    });

  } catch (err) {
    console.error('Analysis error:', err.message || err);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}

// ─── Gemini Explanation Prompts ───
const EXPLAIN_FAKE_PROMPT = `Our AI detection model has classified this image as AI-GENERATED with high confidence.

Look at this image and write a brief 2-3 sentence explanation of what visual clues suggest it is AI-generated. Mention specific artifacts you notice (texture smoothness, lighting inconsistencies, unnatural details, overly perfect features, etc.).

Respond with ONLY the explanation text. No formatting, no JSON, no labels — just 2-3 plain sentences.`;

const EXPLAIN_REAL_PROMPT = `Our AI detection model has classified this image as an AUTHENTIC photograph with high confidence.

Look at this image and write a brief 2-3 sentence explanation of what characteristics suggest it is a real photograph. Mention specific authentic features (natural noise, imperfections, consistent lighting, etc.).

Respond with ONLY the explanation text. No formatting, no JSON, no labels — just 2-3 plain sentences.`;

const EXPLAIN_UNCERTAIN_PROMPT = `Our AI detection model could not definitively determine if this image is AI-generated or real.

Look at this image and write a brief 2-3 sentence explanation of why it's ambiguous. Mention features that could go either way.

Respond with ONLY the explanation text. No formatting, no JSON, no labels — just 2-3 plain sentences.`;

// ─── Rate Limiting ───
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}
