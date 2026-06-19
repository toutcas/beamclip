// Minimal Buffer GraphQL API client.
//
// Docs: https://developers.buffer.com  ·  Endpoint: POST https://api.buffer.com
// Auth: Authorization: Bearer <personal API key>
// Each user supplies their OWN key (Settings → API → Personal Keys in Buffer).

const ENDPOINT = process.env.BUFFER_ENDPOINT || 'https://api.buffer.com';

async function gql(apiKey, query, variables) {
  if (!apiKey) throw new Error('Kein Buffer-API-Key gesetzt (Settings → API → Personal Keys).');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Buffer API antwortete kein JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (res.status === 401) throw new Error('Buffer: 401 Unauthorized — API-Key ungültig oder abgelaufen.');
  if (json.errors?.length) throw new Error('Buffer GraphQL: ' + json.errors.map(e => e.message).join('; '));
  return json.data;
}

export async function listChannels(apiKey) {
  const data = await gql(apiKey, `
    query Channels {
      account {
        organizations {
          id
          name
          channels { id name service type avatar }
        }
      }
    }
  `);
  const orgs = data?.account?.organizations || [];
  // Flatten to channels, annotated with org info.
  const channels = [];
  for (const org of orgs) {
    for (const ch of org.channels || []) {
      channels.push({ ...ch, organizationId: org.id, organizationName: org.name });
    }
  }
  return { organizations: orgs.map(o => ({ id: o.id, name: o.name })), channels };
}

// Build service-aware metadata so reels/shorts are posted correctly.
function buildMetadata(service, opts = {}) {
  switch (service) {
    case 'instagram':
      return { instagram: { type: opts.instagramType || 'reel', shouldShareToFeed: opts.shouldShareToFeed ?? true } };
    case 'youtube':
      return { youtube: { title: opts.youtubeTitle || opts.title || 'Untitled', categoryId: opts.youtubeCategoryId || '20', privacy: opts.youtubePrivacy || 'public' } };
    case 'tiktok':
      return opts.title ? { tiktok: { title: opts.title } } : undefined;
    case 'facebook':
      return { facebook: { type: opts.facebookType || 'reel' } };
    default:
      return undefined;
  }
}

export async function createVideoPost(apiKey, {
  channelId, service, text, videoUrl, thumbnailUrl,
  schedulingType = 'automatic', mode = 'shareNow', dueAt, options = {}
}) {
  const input = {
    channelId,
    text,
    schedulingType,
    mode,
    assets: [{ video: { url: videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) } }]
  };
  if (mode === 'customScheduled' && dueAt) input.dueAt = dueAt;
  const metadata = buildMetadata(service, { ...options, title: options.title || text?.slice(0, 80) });
  if (metadata) input.metadata = metadata;

  const data = await gql(apiKey, `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post { id text status dueAt error }
        }
        ... on MutationError { message }
      }
    }
  `, { input });

  const r = data?.createPost;
  if (r?.message) throw new Error(r.message); // MutationError branch
  if (!r?.post) throw new Error('Unerwartete Antwort von Buffer beim Erstellen des Posts.');
  return r.post;
}

// Best-effort status poll. The public docs don't guarantee a post(id) query, so
// we try it and degrade gracefully (caller keeps the last known status).
export async function getPostStatus(apiKey, postId) {
  try {
    const data = await gql(apiKey, `
      query Post($id: String!) { post(id: $id) { id status error } }
    `, { id: postId });
    return data?.post || null;
  } catch {
    return null; // query shape unsupported on this account/plan — not fatal
  }
}
