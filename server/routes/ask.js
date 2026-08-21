'use strict';
/** ♦ Ask (HavocPianoAI) route. */
const express = require('express');
const { request: undiciRequest } = require('undici');
const { wrap } = require('./helpers');

const router = express.Router();

/* ------------------------------------------------ ♦ Ask (HavocPianoAI 連携) --
 * 動画の「概要欄」を読み込んだアシスタントに質問できる機能。
 * 鍵はユーザー提供のフリーキー。サーバー側のみに保持し、ブラウザには出さない。
 */
const HAVOC_URL = 'https://havoc.chc.ninja/v1/chat/completions';
const HAVOC_KEY = 'sk-step37-8e6f1f4a9b2c3d5e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';
const askBuckets = new Map(); // ip -> {ts[], } 簡易レート制限
setInterval(() => { for (const [k, v] of askBuckets) if (!v.length || Date.now() - v[v.length - 1] > 120000) askBuckets.delete(k); }, 60000).unref?.();
router.post('/api/ask', wrap(async (req, res) => {
  const ip = req.ip || 'anon';
  const now = Date.now();
  const bucket = (askBuckets.get(ip) || []).filter(t => now - t < 60000);
  if (bucket.length >= 8) { res.status(429).json({ error: '質問が多すぎます。少し待ってからお試しください' }); return; }
  bucket.push(now); askBuckets.set(ip, bucket);

  const b = req.body || {};
  const title = String(b.title || '').slice(0, 300);
  const channel = String(b.channel || '').slice(0, 120);
  const description = String(b.description || '').slice(0, 6000);
  const question = String(b.question || '').trim().slice(0, 1500);
  const history = Array.isArray(b.history) ? b.history.slice(-8) : [];
  if (!question) { res.status(400).json({ error: 'question required' }); return; }

  const ctx = [
    title && `タイトル: ${title}`,
    channel && `チャンネル: ${channel}`,
    description && `概要欄:\n${description}`,
  ].filter(Boolean).join('\n');
  const system = {
    role: 'system',
    content:
      'あなたは動画サイト「Vandal」に搭載されたAIアシスタント「♦Ask」です。' +
      'ユーザーが今見ている動画の概要欄・タイトル・チャンネル情報を読み込んだ状態で、質問に簡潔かつ的確に日本語で答えます。' +
      '概要欄に無い情報を聞かれた場合は、概要欄にある内容から分かる範囲で答え、無い場合はその旨を正直に伝えた上で一般的な知識で補足してください。' +
      '回答は読みやすく、必要に応じて箇条書きを使い、長すぎないこと（目安400字以内）。\n\n' +
      '【読み込み済みの動画情報】\n' + (ctx || '(動画情報なし)'),
  };
  const messages = [system];
  for (const m of history) {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
    const content = String(m?.content || '').slice(0, 2000);
    if (role && content) messages.push({ role, content });
  }
  messages.push({ role: 'user', content: question });

  const upstream = await undiciRequest(HAVOC_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + HAVOC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini', messages, max_tokens: 800, temperature: 0.55 }),
    headersTimeout: 26000,
    bodyTimeout: 26000,
  });
  const raw = await upstream.body.text();
  if (upstream.statusCode >= 400) {
    const e = new Error('ask upstream ' + upstream.statusCode);
    e.status = 502; throw e;
  }
  let answer = '';
  try { answer = JSON.parse(raw)?.choices?.[0]?.message?.content || ''; } catch (_) { /* bad json */ }
  if (!answer) { const e = new Error('empty answer'); e.status = 502; throw e; }
  res.json({ answer });
}));

module.exports = { router };
