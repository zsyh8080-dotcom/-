import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.post('/api/detect-object', async (req, res) => {
    try {
      const { imageBase64, mimeType, targetPersianName, targetEnglishAliases } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        targetPersianName?: string;
        targetEnglishAliases?: string[];
      };

      if (!imageBase64 || !targetPersianName) {
        res.status(400).json({ error: 'تصویر یا نام وسیله هدف ارسال نشده است.' });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const englishHint = Array.isArray(targetEnglishAliases)
        ? targetEnglishAliases.join(', ')
        : '';

      const prompt = `Target object to find: "${targetPersianName}" (${englishHint}).
We use a strict Two-Stage Image Validation System with a high confidence threshold (>= 0.78):
1. Identify the specific household object held or shown in front of the camera (if only a person/face/hand/wall/empty room is visible, set hasObject=false and detectedObjectPersian="فقط تصویر اتاق یا دست").
2. Evaluate two-stage validation:
   - If the object shown is clearly and unmistakably "${targetPersianName}" (${englishHint}) with good angle/lighting: set isTargetMatch=true, isNearTarget=true, and confidence between 0.80 and 0.98.
   - If the object might be "${targetPersianName}" but is too blurry, too far, or partially hidden (Stage 1 candidate, needs better view for Stage 2): set isTargetMatch=false, isNearTarget=true, confidence between 0.58 and 0.74, and guide the child to hold it steadier/closer.
   - CRITICAL: If the user shows a DIFFERENT object (e.g., showing a "قاشق" spoon when target is "مسواک" toothbrush, or showing a phone when target is a remote): set isTargetMatch=false, isNearTarget=false, confidence between 0.80 and 0.95 for the wrong object, and set detectedObjectPersian to the actual object shown (e.g. "قاشق") so the red warning frame alerts the child!`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: cleanBase64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are Delphi, a strictly accurate two-stage visual object detector for a Persian treasure hunt game. Never accept the wrong object as the target. Always identify what is truly in front of the camera in natural Persian.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hasObject: {
                type: Type.BOOLEAN,
                description:
                  'True if a distinct household object is being shown or visible in the frame (not just a face, empty hand, or blank wall).',
              },
              isTargetMatch: {
                type: Type.BOOLEAN,
                description:
                  'True ONLY if the target object itself is clearly visible with high confidence (>= 0.78). False if a different object is shown.',
              },
              isNearTarget: {
                type: Type.BOOLEAN,
                description:
                  'True if the object is the target or very close to the target (Stage 1 candidate), False if it is a completely different object or empty frame.',
              },
              detectedObjectPersian: {
                type: Type.STRING,
                description:
                  'Short Persian name of the object actually seen in the frame (e.g., "قاشق", "مسواک", "لیوان", "گوشی موبایل", "فقط دست یا صورت").',
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Confidence score between 0.0 and 1.0.',
              },
              feedbackPersian: {
                type: Type.STRING,
                description:
                  'Short friendly Persian sentence from Delphi explaining what it sees (e.g., "این که قاشقه! من دنبال مسواک می‌گردم!" or "مرحله ۱ و ۲ تأیید شد! این واقعاً مسواکه!").',
              },
            },
            required: [
              'hasObject',
              'isTargetMatch',
              'isNearTarget',
              'detectedObjectPersian',
              'confidence',
              'feedbackPersian',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err: unknown) {
      console.error('Error in /api/detect-object:', err);
      const message = err instanceof Error ? err.message : 'خطا در بررسی تصویر';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
