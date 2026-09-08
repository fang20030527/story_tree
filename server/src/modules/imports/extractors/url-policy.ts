import { lookup as nodeLookup } from 'node:dns/promises';

import * as ipaddr from 'ipaddr.js';

import { AppError } from '../../../core/errors';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHost = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface SafeHttpTarget extends ResolvedAddress {
  url: URL;
}

export const resolveWithNode: ResolveHost = async (hostname) => {
  const rows = await nodeLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({
    address: row.address,
    family: row.family as 4 | 6,
  }));
};

export async function resolveSafeHttpTarget(
  rawUrl: string | URL,
  resolveHost: ResolveHost = resolveWithNode,
): Promise<SafeHttpTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blocked();
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    throw blocked();
  }
  url.hash = '';

  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  let rows: readonly ResolvedAddress[];
  if (ipaddr.isValid(hostname)) {
    rows = [
      {
        address: hostname,
        family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6,
      },
    ];
  } else {
    try {
      rows = await resolveHost(hostname);
    } catch {
      throw new AppError('IMPORT_FETCH_FAILED', '网页暂时无法读取', 503, true);
    }
  }

  if (rows.length === 0 || rows.some((row) => !isPublicUnicast(row.address))) {
    throw blocked();
  }
  return { url, ...rows[0]! };
}

function isPublicUnicast(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === 'unicast';
}

function blocked(): AppError {
  return new AppError('IMPORT_FETCH_BLOCKED', '该网络地址不允许导入', 422);
}
