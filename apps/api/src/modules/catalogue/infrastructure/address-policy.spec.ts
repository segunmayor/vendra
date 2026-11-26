import { isNonPublicAddress } from './address-policy';

describe('isNonPublicAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'fc12::3', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::', 'not-an-ip', '',
  ])('blocks %s', (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '102.89.1.10', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8'])(
    'allows public %s',
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    },
  );
});
