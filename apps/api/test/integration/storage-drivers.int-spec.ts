import { randomUUID } from 'node:crypto';
import { probe } from '../../src/modules/storage/application/drivers';
import { StorageDriver, StorageUnavailable } from '../../src/modules/storage/application/ports';
import { AzureBlobDriver } from '../../src/modules/storage/infrastructure/azure.driver';
import { MegaDriver } from '../../src/modules/storage/infrastructure/mega.driver';
import { S3Driver } from '../../src/modules/storage/infrastructure/s3.driver';

/**
 * The real drivers against real services. Skipped unless the settings are given, for example
 * against local emulators (s3rver or MinIO, Azurite) or a throwaway bucket:
 *
 *   STORAGE_TEST_S3_ENDPOINT=http://127.0.0.1:4569 STORAGE_TEST_S3_BUCKET=test-bucket \
 *   STORAGE_TEST_S3_KEY=S3RVER STORAGE_TEST_S3_SECRET=S3RVER STORAGE_TEST_S3_PATH_STYLE=true
 *
 *   STORAGE_TEST_AZURE_ENDPOINT=http://127.0.0.1:10000/devstoreaccount1 \
 *   STORAGE_TEST_AZURE_ACCOUNT=devstoreaccount1 STORAGE_TEST_AZURE_KEY=<Azurite's published key>
 *
 *   STORAGE_TEST_MEGA_EMAIL=... STORAGE_TEST_MEGA_PASSWORD=...   (a throwaway MEGA account)
 */
const env = process.env;
const run = Math.random().toString(36).slice(2, 8);

function contract(name: string, enabled: boolean, make: () => StorageDriver, makeWrong: () => StorageDriver) {
  (enabled ? describe : describe.skip)(name, () => {
    let driver: StorageDriver;
    beforeAll(() => {
      driver = make();
    });
    afterAll(() => driver?.close?.());

    it('passes the check staff run before using a location', async () => {
      await probe(driver, `vendra-tests/${run}/check.txt`);
    });

    it('stores and returns binary files byte for byte, under nested keys', async () => {
      const content = new Uint8Array(70_000).map((_, index) => (index * 31) % 256);
      const key = `vendra-tests/${run}/product-media/2026/11/${randomUUID()}.png`;
      await driver.put(key, content, 'image/png');
      expect(Buffer.compare(Buffer.from(await driver.get(key)), Buffer.from(content))).toBe(0);
      await driver.put(key, new Uint8Array([1, 2, 3]), 'image/png');
      expect([...(await driver.get(key))]).toEqual([1, 2, 3]);
      await driver.delete(key);
      await expect(driver.get(key)).rejects.toBeInstanceOf(StorageUnavailable);
    });

    it('deletes files that are already gone without failing', async () => {
      await driver.delete(`vendra-tests/${run}/never-existed.txt`);
    });

    it('explains wrong credentials in plain words', async () => {
      const wrong = makeWrong();
      const error = await wrong.put(`vendra-tests/${run}/x.txt`, new Uint8Array([1]), 'text/plain').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageUnavailable);
      expect((error as Error).message).not.toMatch(/at |\n|stack/i);
      await wrong.close?.();
    });
  });
}

const s3 = (secret: string, keyId = env.STORAGE_TEST_S3_KEY ?? '') =>
  new S3Driver({
    endpoint: env.STORAGE_TEST_S3_ENDPOINT,
    region: env.STORAGE_TEST_S3_REGION ?? 'us-east-1',
    bucket: env.STORAGE_TEST_S3_BUCKET ?? '',
    pathStyle: env.STORAGE_TEST_S3_PATH_STYLE === 'true',
    accessKeyId: keyId,
    secretAccessKey: secret,
  });
contract('S3 driver', Boolean(env.STORAGE_TEST_S3_BUCKET), () => s3(env.STORAGE_TEST_S3_SECRET ?? ''), () => s3('definitely-wrong-secret', 'AKIAWRONGKEY0000'));

const azure = (key: string) =>
  new AzureBlobDriver({
    accountName: env.STORAGE_TEST_AZURE_ACCOUNT ?? '',
    accountKey: key,
    container: env.STORAGE_TEST_AZURE_CONTAINER ?? 'vendra-tests',
    endpoint: env.STORAGE_TEST_AZURE_ENDPOINT,
  });
contract('Azure Blob driver', Boolean(env.STORAGE_TEST_AZURE_ACCOUNT), () => azure(env.STORAGE_TEST_AZURE_KEY ?? ''), () => azure(Buffer.from('wrong-key').toString('base64')));

const mega = (password: string) => new MegaDriver({ email: env.STORAGE_TEST_MEGA_EMAIL ?? '', password, folder: 'Vendra tests' });
contract('MEGA driver', Boolean(env.STORAGE_TEST_MEGA_EMAIL), () => mega(env.STORAGE_TEST_MEGA_PASSWORD ?? ''), () => mega('definitely-wrong-password'));
