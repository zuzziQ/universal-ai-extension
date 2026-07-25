// Custom WebCrypto Helper for AWS V4 Signatures and Hashing in Chrome Extension

export interface AWSV4Credentials {
  access_key_id: string;
  secret_access_key: string;
  session_token?: string;
}

export async function sha256Hex(msg: string | Uint8Array): Promise<string> {
  const data = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(key: Uint8Array | string, msg: string | Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const msgData = typeof msg === 'string' ? encoder.encode(msg) : msg;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData as any);
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(key: Uint8Array | string, msg: string | Uint8Array): Promise<string> {
  const sig = await hmacSha256(key, msg);
  return Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('');
}

// AWS V4 Authorization Header Generator (Custom translation of Sếp's python _aws_v4_auth)
export async function awsV4Auth(
  method: string,
  urlStr: string,
  payloadHash: string,
  creds: AWSV4Credentials,
  service = 'imagex',
  region = 'ap-singapore-1'
): Promise<Record<string, string>> {
  const url = new URL(urlStr);
  const path = url.pathname || '/';
  
  const qsParams: [string, string][] = [];
  url.searchParams.forEach((value, key) => {
    qsParams.push([encodeURIComponent(key), encodeURIComponent(value)]);
  });
  qsParams.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const canonicalQs = qsParams.map(pair => `${pair[0]}=${pair[1]}`).join('&');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const signed: Record<string, string> = {
    'x-amz-date': amzDate
  };
  if (creds.session_token) {
    signed['x-amz-security-token'] = creds.session_token;
  }
  if (method.toUpperCase() === 'POST') {
    signed['x-amz-content-sha256'] = payloadHash;
  }

  const sortedKeys = Object.keys(signed).sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  const canonicalHeaders = sortedKeys.map(k => `${k.toLowerCase()}:${signed[k]}\n`).join('');
  const signedHeaders = sortedKeys.map(k => k.toLowerCase()).join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQs,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalReqHash = await sha256Hex(canonicalRequest);
  
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalReqHash
  ].join('\n');

  const kDate = await hmacSha256(`AWS4${creds.secret_access_key}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const auth = `AWS4-HMAC-SHA256 Credential=${creds.access_key_id}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return {
    ...signed,
    'authorization': auth
  };
}

export function md5(s: string): string {
  function r(n: number, sh: number) {
    return (n << sh) | (n >>> (32 - sh));
  }
  const bytes = new TextEncoder().encode(s);
  const msg = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const len = bytes.length * 8;
  msg[msg.length - 8] = len & 0xff;
  msg[msg.length - 7] = (len >>> 8) & 0xff;
  msg[msg.length - 6] = (len >>> 16) & 0xff;
  msg[msg.length - 5] = (len >>> 24) & 0xff;
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const sh = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  for (let o = 0; o < msg.length; o += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      m[i] = msg[o + i * 4] | (msg[o + i * 4 + 1] << 8) | (msg[o + i * 4 + 2] << 16) | (msg[o + i * 4 + 3] << 24);
    }
    let A = a, B = b, C = c, D = d;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + k[i] + m[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + r(f, sh[i])) >>> 0;
    }
    a = (a + A) >>> 0;
    b = (b + B) >>> 0;
    c = (c + C) >>> 0;
    d = (d + D) >>> 0;
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    out[i] = (a >>> (i * 8)) & 0xff;
    out[i + 4] = (b >>> (i * 8)) & 0xff;
    out[i + 8] = (c >>> (i * 8)) & 0xff;
    out[i + 12] = (d >>> (i * 8)) & 0xff;
  }
  return Array.from(out).map(x => x.toString(16).padStart(2, '0')).join('');
}

export function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}
