// S3-compatible storage adapter.
//
// Works with Cloudflare R2, AWS S3, Backblaze B2, MinIO, Wasabi … anything that
// speaks the S3 API. Uploads with multipart + progress reporting.
//
// The bucket's S3 endpoint is usually NOT publicly readable, so `publicBaseUrl`
// defines how a stored object maps to a fetchable URL that Buffer can download
// (e.g. an R2 r2.dev URL / custom domain, or a CloudFront/website URL for S3).

import fs from 'node:fs';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

function makeClient(s3) {
  if (!s3.bucket) throw new Error('Storage: kein Bucket konfiguriert.');
  if (!s3.accessKeyId || !s3.secretAccessKey) throw new Error('Storage: Access Key / Secret fehlt.');
  return new S3Client({
    region: s3.region || 'auto',
    endpoint: s3.endpoint || undefined, // omit -> AWS S3 default endpoints
    forcePathStyle: Boolean(s3.endpoint), // R2/MinIO need path-style
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
  });
}

function publicUrl(s3, key) {
  const base = (s3.publicBaseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Storage: publicBaseUrl fehlt — ohne öffentliche URL kann Buffer das Video nicht laden.');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function testConnection(s3) {
  const client = makeClient(s3);
  await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
  return true;
}

// Uploads a local file; calls onProgress({ loaded, total, percent }).
export async function upload(s3, { filePath, key, contentType, onProgress }) {
  const client = makeClient(s3);
  const fullKey = (s3.keyPrefix || '').replace(/^\/+/, '') + key;
  const body = fs.createReadStream(filePath);
  const total = fs.statSync(filePath).size;

  const uploader = new Upload({
    client,
    params: {
      Bucket: s3.bucket,
      Key: fullKey,
      Body: body,
      ContentType: contentType || 'application/octet-stream'
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024
  });

  uploader.on('httpUploadProgress', (p) => {
    const loaded = p.loaded || 0;
    onProgress?.({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 0 });
  });

  await uploader.done();
  return { url: publicUrl(s3, fullKey), key: fullKey };
}
