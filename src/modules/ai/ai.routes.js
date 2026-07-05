import { Router } from 'express';
import { aiService } from './ai.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/ApiResponse.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import * as v from './ai.validators.js';

/**
 * @openapi
 * tags:
 *   - name: AI
 *     description: AI assistant (Groq / Llama) — chat, JD generation, resume screening, doc summary
 */
const router = Router();

router.use(authenticate);
// AI calls are relatively expensive — apply the stricter auth rate limiter.
router.use(authRateLimiter);

/**
 * @openapi
 * /ai/status:
 *   get: { tags: [AI], summary: Whether AI is configured on the server }
 */
router.get('/status', (_req, res) => ok(res, { configured: aiService.configured() }, 'AI status'));

/**
 * @openapi
 * /ai/chat:
 *   post:
 *     tags: [AI]
 *     summary: HR assistant chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 items: { type: object, properties: { role: { type: string, enum: [user, assistant] }, content: { type: string } } }
 *               context: { type: string }
 *     responses:
 *       200: { description: "{ reply }" }
 *       503: { description: AI not configured }
 */
router.post('/chat', validate({ body: v.chatSchema }), asyncHandler(async (req, res) =>
  ok(res, await aiService.chat(req.body), 'AI reply')
));

/**
 * @openapi
 * /ai/generate-jd:
 *   post: { tags: [AI], summary: Generate a job description (markdown) }
 */
router.post('/generate-jd', validate({ body: v.generateJdSchema }), asyncHandler(async (req, res) =>
  ok(res, await aiService.generateJobDescription(req.body), 'Job description generated')
));

/**
 * @openapi
 * /ai/screen-resume:
 *   post: { tags: [AI], summary: Screen a resume against a role (returns score/strengths/gaps) }
 */
router.post('/screen-resume', validate({ body: v.screenResumeSchema }), asyncHandler(async (req, res) =>
  ok(res, await aiService.screenResume(req.body), 'Resume screened')
));

/**
 * @openapi
 * /ai/summarize-document:
 *   post: { tags: [AI], summary: Summarize an HR document (returns summary/keyPoints/dates) }
 */
router.post('/summarize-document', validate({ body: v.summarizeSchema }), asyncHandler(async (req, res) =>
  ok(res, await aiService.summarizeDocument(req.body), 'Document summarized')
));

export default router;
