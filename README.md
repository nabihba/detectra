# Detectra — AI-Generated Image Detection

Instantly detect AI-generated images with advanced multimodal AI analysis.

## Quick Start (Local Development)

1. Install dependencies:
```bash
npm install
```

2. Run the dev server with your Gemini API key:
```powershell
$env:GEMINI_API_KEY="your-key-here"; npm run dev
```

3. Open http://localhost:3000

## Deploy to Vercel (Production)

1. Push code to GitHub
2. Import repo on [vercel.com](https://vercel.com)
3. Set **Root Directory** to `web_app`
4. Add `GEMINI_API_KEY` as an environment variable
5. Deploy — done!

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (zero build step)
- **Backend**: Vercel Serverless Function
- **AI Engine**: Google Gemini Vision API
- **Hosting**: Vercel Free Tier
