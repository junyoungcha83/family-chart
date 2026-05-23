// family-chart 데이터 동기화 API
// - GET  /api/family : 누구나 읽기 (현재 저장된 JSON 반환)
// - PUT  /api/family : X-Edit-Token 헤더가 EDIT_TOKEN 과 일치할 때만 저장
//
// KV: FAMILY (단일 키 "family-data")
// Secret: EDIT_TOKEN (편집용 비밀번호)

const KEY = 'family-data';
const MAX_BYTES = 8 * 1024 * 1024;  // 8MB — KV 값 한도(25MB) 내에서 안전 마진

const ALLOWED_ORIGINS = [
  'https://junyoungcha83.github.io',
  'http://localhost:8001',
  'http://localhost:8000',
  'http://127.0.0.1:8001',
];

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === '/api/family') {
      if (req.method === 'GET') {
        const raw = await env.FAMILY.get(KEY);
        return new Response(raw ?? 'null', {
          headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      if (req.method === 'PUT') {
        const token = req.headers.get('X-Edit-Token') || '';
        if (!env.EDIT_TOKEN || token !== env.EDIT_TOKEN) {
          return json({ error: 'unauthorized' }, 401, cors);
        }
        const body = await req.text();
        if (body.length > MAX_BYTES) {
          return json({ error: 'too_large', limit: MAX_BYTES, size: body.length }, 413, cors);
        }
        try {
          const parsed = JSON.parse(body);
          if (!parsed || !Array.isArray(parsed.people)) {
            return json({ error: 'invalid_shape' }, 400, cors);
          }
        } catch {
          return json({ error: 'invalid_json' }, 400, cors);
        }
        await env.FAMILY.put(KEY, body);
        return json({ ok: true, bytes: body.length }, 200, cors);
      }

      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    if (url.pathname === '/' || url.pathname === '/api/health') {
      return json({ ok: true, service: 'family-chart-api' }, 200, cors);
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};
