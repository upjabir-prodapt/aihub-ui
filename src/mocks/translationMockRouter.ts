import type { IncomingMessage, ServerResponse } from 'node:http';
import { mockDb } from './mockDb.ts';


export async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export function parseMultipartFields(body: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const boundaryMatch = body.match(/^--[^\r\n]+/);
  if (!boundaryMatch) return fields;

  const boundary = boundaryMatch[0];
  const parts = body.split(boundary).slice(1, -1);

  for (const part of parts) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const filenameMatch = part.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      fields._filename = filenameMatch[1];
    }
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const value = part.substring(headerEnd + 4).replace(/\r\n$/, '').trim();
      if (name.endsWith('[]')) {
        const cleanName = name.replace('[]', '');
        if (!Array.isArray(fields[cleanName])) {
          fields[cleanName] = [];
        }
        (fields[cleanName] as string[]).push(value);
      } else {
        fields[name] = value;
      }
    }
  }
  return fields;
}

export async function handleTranslationMock(
  pathname: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (pathname === '/api/translation/v1/jobs' && method === 'GET') {
    const jobs = mockDb.getTranslationJobs();
    sendJson(res, 200, { jobs, total: jobs.length, limit: 50, offset: 0 });
    return true;
  }

  if (pathname === '/api/translation/v1/jobs/status' && method === 'POST') {
    const raw = await readBody(req);
    try {
      const parsed = JSON.parse(raw) as { job_ids?: string[] };
      const jobIds = parsed.job_ids || [];
      const jobs = mockDb.getMultipleTranslationJobStatuses(jobIds);
      sendJson(res, 200, { jobs, total: jobs.length });
    } catch {
      sendJson(res, 400, { error: { message: 'Invalid JSON payload' } });
    }
    return true;
  }

  if (pathname === '/api/translation/v1/translate' && method === 'POST') {
    const raw = await readBody(req);
    const fields = parseMultipartFields(raw);
    const filename = (fields._filename as string) || (fields.filename as string) || 'pasted-text.txt';
    const sourceLang = (fields.source_language as string) || 'en';
    const domain = (fields.domain as string) || 'commercial';
    let targetLangs: string[] = [];

    if (Array.isArray(fields.target_languages)) {
      targetLangs = fields.target_languages;
    } else if (typeof fields.target_languages === 'string') {
      targetLangs = [fields.target_languages];
    } else {
      targetLangs = ['de'];
    }

    const result = mockDb.createTranslationJobs(filename, sourceLang, targetLangs, domain);
    sendJson(res, 202, result);
    return true;
  }

  const translateMatch = pathname.match(/^\/api\/translation\/v1\/translate\/([^/]+)$/);
  if (translateMatch && method === 'GET') {
    const jobId = translateMatch[1];
    const status = mockDb.getTranslationJobStatus(jobId);
    if (!status) {
      sendJson(res, 404, { error: { message: `Job ${jobId} not found` } });
    } else {
      sendJson(res, 200, status);
    }
    return true;
  }

  const transDownloadMatch = pathname.match(/^\/api\/translation\/v1\/jobs\/([^/]+)\/download$/);
  if (transDownloadMatch && method === 'GET') {
    const jobId = transDownloadMatch[1];
    const status = mockDb.getTranslationJobStatus(jobId);
    const filename = status?.result?.translated_document?.filename || `translated_${jobId}.docx`;
    sendJson(res, 200, {
      download_url: `/api/translation/v1/jobs/${jobId}/file`,
      filename,
      expires_in: 3600,
      file_size: 24576,
    });
    return true;
  }

  const transFileMatch = pathname.match(/^\/api\/translation\/v1\/jobs\/([^/]+)\/file$/);
  if (transFileMatch && method === 'GET') {
    const jobId = transFileMatch[1];
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="translated_${jobId}.txt"`);
    res.end(`--- Translated Document (Mock Output: ${jobId}) ---\n\nColt Technology Services - Master Services Agreement (Translated)\n\nAlle Rechte vorbehalten. Dokument wurde erfolgreich von Colt Translation AI übersetzt.`);
    return true;
  }

  const transCancelMatch = pathname.match(/^\/api\/translation\/v1\/jobs\/([^/]+)$/);
  if (transCancelMatch && method === 'DELETE') {
    const jobId = transCancelMatch[1];
    mockDb.cancelTranslationJob(jobId);
    sendJson(res, 200, { message: `Translation job ${jobId} cancelled.` });
    return true;
  }

  const reviewMatch = pathname.match(/^\/api\/translation\/v1\/reviews\/([^/]+)$/);
  if (reviewMatch && method === 'POST') {
    const jobId = reviewMatch[1];
    const raw = await readBody(req);
    try {
      const parsed = JSON.parse(raw) as { rating: number; comment?: string };
      const review = mockDb.addReview(jobId, parsed.rating, parsed.comment);
      sendJson(res, 201, review);
    } catch {
      sendJson(res, 400, { error: { message: 'Invalid review payload' } });
    }
    return true;
  }

  return false;
}
