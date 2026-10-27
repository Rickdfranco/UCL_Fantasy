// Tiny storage layer on Upstash Redis (free, added from Vercel's Storage tab).
// Uses its REST API with plain fetch, so no packages are needed.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const storeEnabled = () => !!(URL_ && TOKEN);

async function cmd(args) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Storage error: ${json.error || res.status}`);
  return json.result;
}

async function getSnapshot(name) {
  const v = await cmd(['GET', `snap:${name}`]);
  return v ? JSON.parse(v) : null;
}
const setSnapshot = (name, obj) => cmd(['SET', `snap:${name}`, JSON.stringify(obj)]);

module.exports = { storeEnabled, getSnapshot, setSnapshot };
