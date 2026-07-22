import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function client() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error("S3 rank background storage is not configured");
  return new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
}

export async function uploadBackground(owner: string, body: Uint8Array, contentType: string) {
  if (!process.env.S3_PUBLIC_URL) throw new Error("S3_PUBLIC_URL is required for rank backgrounds");
  const key = `rank-backgrounds/${owner}/${Date.now()}`;
  await client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function deleteBackground(key: string) {
  await client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
}

export function backgroundUrl(key: string | null | undefined) {
  return key && process.env.S3_PUBLIC_URL ? `${process.env.S3_PUBLIC_URL.replace(/\/$/, "")}/${key}` : undefined;
}
