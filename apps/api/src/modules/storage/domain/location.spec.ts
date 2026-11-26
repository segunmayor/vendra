import { DomainError } from '../../../shared-kernel';
import { checkLocation, hint, objectKey, STORAGE_TYPES } from './location';

const s3 = (config: Record<string, string>, name = 'Photos on R2') => ({ type: 's3_compatible', name, config });
const keys = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-value-123456' };

describe('storage location checks', () => {
  it('fills defaults and trims the folder', () => {
    const result = checkLocation(s3({ endpoint: 'https://abc.r2.cloudflarestorage.com/', bucket: 'vendra-files', prefix: '/shop/files/' }), keys, {});
    expect(result.config).toEqual({ endpoint: 'https://abc.r2.cloudflarestorage.com', region: 'auto', bucket: 'vendra-files', prefix: 'shop/files', pathStyle: 'false' });
    expect(result.secrets).toEqual(keys);
  });

  it('keeps saved credentials when the fields are left blank', () => {
    const result = checkLocation(s3({ endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'vendra-files' }), { accessKeyId: '', secretAccessKey: '  ' }, keys);
    expect(result.secrets).toEqual(keys);
  });

  it.each([
    [{ endpoint: 'http://files.example.com', bucket: 'b-1' }, 'must start with https://'],
    [{ endpoint: 'https://user:pw@files.example.com', bucket: 'b-1' }, 'plain address'],
    [{ endpoint: 'https://files.example.com', bucket: 'Bad_Bucket' }, 'Bucket names'],
    [{ endpoint: 'https://files.example.com', bucket: 'ok-bucket', prefix: 'a//b' }, 'folder may use'],
    [{ endpoint: 'https://files.example.com', bucket: 'ok-bucket', pathStyle: 'yes' }, 'on or off'],
    [{ bucket: 'ok-bucket' }, 'Enter the endpoint'],
  ])('refuses %j', (config, message) => {
    expect(() => checkLocation(s3(config), keys, {})).toThrow(message);
  });

  it('allows http only for a service on this machine', () => {
    expect(checkLocation(s3({ endpoint: 'http://127.0.0.1:9000', bucket: 'local-bucket' }), keys, {}).config.endpoint).toBe('http://127.0.0.1:9000');
  });

  it('needs every required credential', () => {
    expect(() => checkLocation(s3({ endpoint: 'https://files.example.com', bucket: 'ok-bucket' }), { accessKeyId: 'only' }, {})).toThrow('secret access key');
  });

  it('checks MEGA emails and Azure names', () => {
    expect(() => checkLocation({ type: 'mega', name: 'Backup drive', config: {} }, { email: 'not-an-email', password: 'x' }, {})).toThrow('email address');
    expect(() => checkLocation({ type: 'azure_blob', name: 'Azure', config: { accountName: 'Has-Caps' } }, { accountKey: 'k' }, {})).toThrow('Storage account names');
    const azure = checkLocation({ type: 'azure_blob', name: 'Azure', config: { accountName: 'vendrafiles' } }, { accountKey: 'k' }, {});
    expect(azure.config).toMatchObject({ accountName: 'vendrafiles', container: 'vendra', prefix: 'vendra', endpoint: '' });
  });

  it('refuses unknown types and poor names', () => {
    expect(() => checkLocation({ type: 'ftp', name: 'Old server', config: {} }, {}, {})).toThrow(DomainError);
    expect(() => checkLocation(s3({ endpoint: 'https://files.example.com', bucket: 'ok-bucket' }, 'x'), keys, {})).toThrow('Names are 2 to 60');
  });

  it('describes every type with at least one credential', () => {
    for (const type of STORAGE_TYPES) expect(type.credentials.length).toBeGreaterThan(0);
  });
});

describe('object keys', () => {
  it('builds dated keys from the id, never a chosen name', () => {
    const at = new Date('2026-03-05T10:00:00Z');
    expect(objectKey('vendra', 'product-media', 'abc', 'PNG', at)).toBe('vendra/product-media/2026/03/abc.png');
    expect(objectKey('', 'seller-documents', 'abc', '../pdf', at)).toBe('seller-documents/2026/03/abc.pdf');
  });

  it('hides all but the end of a credential', () => {
    expect(hint('short')).toBe('••••');
    expect(hint('abcdefghijkl')).toBe('••••ijkl');
  });
});
