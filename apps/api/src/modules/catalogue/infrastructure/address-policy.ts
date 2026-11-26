import { BlockList, isIP } from 'node:net';

/**
 * Addresses a server-side download must never reach: this machine, private networks, cloud
 * metadata services (169.254.169.254), carrier NAT, documentation and multicast ranges, and
 * IPv6 equivalents. Checked on every resolved address, so a public name pointing inside is refused.
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

const MAPPED = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i;

/** True when an address is not on the public internet. Unparseable input counts as blocked. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = MAPPED.exec(address);
  if (mapped) {
    const v4 = mapped[1] ?? (() => {
      const high = parseInt(mapped[2]!, 16);
      const low = parseInt(mapped[3]!, 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    })();
    return blocked.check(v4, 'ipv4');
  }
  if (/^::ffff:/i.test(address)) return true;
  return blocked.check(address, 'ipv6');
}
