import Groq from 'groq-sdk';
import { config } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../config/logger.js';

/**
 * AI service backed by Groq (free, OpenAI-compatible, Llama models). Centralizes
 * the client, prompt templates and robust error mapping so controllers stay
 * thin. If GROQ_API_KEY is unset every call fails with a clear 503 rather than
 * crashing the app at boot.
 */
let client = null;
function groq() {
  if (!config.ai.enabled) {
    throw new ApiError(503, 'AI is not configured. Set GROQ_API_KEY on the server.', {
      code: 'AI_NOT_CONFIGURED',
    });
  }
  if (!client) client = new Groq({ apiKey: config.ai.groqApiKey });
  return client;
}

const HR_SYSTEM = `You are the AI assistant inside Agnibits HRMS, an HR management app.
Help employees and HR staff with: HR policy questions, leave/attendance/payroll concepts,
drafting job descriptions, screening resumes, and summarizing HR documents.
Be concise, professional and accurate. If unsure, say so. Never invent
company-specific policy numbers — speak in general terms unless given the data.`;

/** Run a chat completion and return the assistant text, mapping provider errors. */
async function complete(params) {
  try {
    const res = await groq().chat.completions.create({ model: config.ai.model, ...params });
    return res.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error({ err: err?.message, status: err?.status }, 'Groq API error');
    if (err?.status === 401) throw new ApiError(502, 'AI provider authentication failed (check GROQ_API_KEY)', { code: 'AI_AUTH_FAILED' });
    if (err?.status === 429) throw ApiError.tooManyRequests('AI rate limit reached, please retry shortly', { code: 'AI_RATE_LIMIT' });
    throw new ApiError(502, 'AI provider is unavailable, please try again', { code: 'AI_UPSTREAM_ERROR' });
  }
}

function parseJson(text, code = 'AI_BAD_JSON') {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, 'AI returned an unexpected response', { code });
  }
}

export const aiService = {
  configured: () => config.ai.enabled,

  async chat({ messages = [], context = '' }) {
    const reply = await complete({
      temperature: 0.7,
      messages: [
        { role: 'system', content: `${HR_SYSTEM}${context ? `\n\nContext: ${context}` : ''}` },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content ?? ''),
        })),
      ],
    });
    return { reply };
  },

  async generateJobDescription({ title, department, location, type, seniority }) {
    const jobDescription = await complete({
      temperature: 0.8,
      messages: [
        { role: 'system', content: 'You are an expert HR recruiter. Write clean markdown.' },
        {
          role: 'user',
          content: `Write a professional job description.
Title: ${title}
Department: ${department || 'N/A'}
Location: ${location || 'Remote'}
Employment type: ${type || 'Full-time'}
Seniority: ${seniority || 'Mid'}
Include: a 2-3 line intro, "Responsibilities" (5-7 bullets), "Requirements" (5-7 bullets), and "Nice to have" (3 bullets).`,
        },
      ],
    });
    return { jobDescription };
  },

  async screenResume({ jobTitle, resumeText }) {
    const text = await complete({
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an ATS resume screener. Reply ONLY with JSON.' },
        {
          role: 'user',
          content: `Screen this resume for the role "${jobTitle}".
Return JSON: {"score": <0-10 number>, "summary": "<2 lines>", "strengths": ["..."], "gaps": ["..."], "recommendation": "STRONG_MATCH | MAYBE | WEAK"}.

RESUME:
${resumeText}`,
        },
      ],
    });
    return parseJson(text);
  },

  async summarizeDocument({ text }) {
    const out = await complete({
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You summarize HR documents. Reply ONLY with JSON.' },
        {
          role: 'user',
          content: `Summarize this HR document.
Return JSON: {"summary": "<3 lines>", "keyPoints": ["..."], "importantDates": ["..."]}.

DOCUMENT:
${text}`,
        },
      ],
    });
    return parseJson(out);
  },
};

export default aiService;
