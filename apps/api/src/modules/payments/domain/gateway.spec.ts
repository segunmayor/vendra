import { checkGateway, GatewayState, hint } from './gateway';

const paystack = (over: Partial<GatewayState> = {}): GatewayState => ({
  id: 'g1',
  type: 'paystack',
  name: 'Paystack',
  enabled: false,
  mode: 'test',
  position: 0,
  config: {},
  secretHints: {},
  version: 0,
  ...over,
});

describe('gateway configuration', () => {
  it('fills the default API address and keeps a key that matches the mode', () => {
    const result = checkGateway(paystack(), { secretKey: 'sk_test_1234567890' }, {});
    expect(result).toEqual({ config: { apiBaseUrl: 'https://api.paystack.co' }, secrets: { secretKey: 'sk_test_1234567890' } });
  });

  it('refuses a live key in test mode and a test key in live mode', () => {
    expect(() => checkGateway(paystack(), { secretKey: 'sk_live_1234567890' }, {})).toThrow('must start with sk_test_');
    expect(() => checkGateway(paystack({ mode: 'live' }), { secretKey: 'sk_test_1234567890' }, {})).toThrow('must start with sk_live_');
  });

  it('re-checks a saved key when the mode changes', () => {
    expect(() => checkGateway(paystack({ mode: 'live' }), {}, { secretKey: 'sk_test_1234567890' })).toThrow('sk_live_');
  });

  it('keeps saved credentials when the field is left blank', () => {
    expect(checkGateway(paystack(), { secretKey: '' }, { secretKey: 'sk_test_saved_value' }).secrets).toEqual({ secretKey: 'sk_test_saved_value' });
  });

  it('needs every credential before it can be turned on', () => {
    expect(() => checkGateway(paystack({ enabled: true }), {}, {})).toThrow('Enter Secret key before turning this gateway on');
    expect(() => checkGateway(paystack({ type: 'flutterwave', enabled: true }), { secretKey: 'FLWSECK_TEST-abcdefgh' }, {})).toThrow('Webhook secret hash');
  });

  it('refuses unsafe API addresses but allows a local test double', () => {
    expect(() => checkGateway(paystack({ config: { apiBaseUrl: 'http://evil.example' } }), {}, {})).toThrow('https://');
    expect(() => checkGateway(paystack({ config: { apiBaseUrl: 'javascript:alert(1)' } }), {}, {})).toThrow('https://');
    expect(checkGateway(paystack({ config: { apiBaseUrl: 'http://127.0.0.1:9999/' } }), {}, {}).config.apiBaseUrl).toBe('http://127.0.0.1:9999');
  });

  it('refuses unknown types and bad names', () => {
    expect(() => checkGateway(paystack({ type: 'mystery' }), {}, {})).toThrow('Unknown gateway type');
    expect(() => checkGateway(paystack({ name: 'x' }), {}, {})).toThrow('2 to 60');
  });

  it('shows only the last four characters of a secret', () => {
    expect(hint('sk_test_abcdef123456')).toBe('••••3456');
    expect(hint('short')).toBe('••••');
  });
});
