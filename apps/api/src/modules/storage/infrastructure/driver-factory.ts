import { DriverFactory, DriverKind, StorageDriver, StorageUnavailable } from '../application/ports';
import { AzureBlobDriver } from './azure.driver';
import { MegaDriver } from './mega.driver';
import { S3Driver } from './s3.driver';

const GOOGLE_ENDPOINT = 'https://storage.googleapis.com';

export class StorageDriverFactory implements DriverFactory {
  create(driver: DriverKind, type: string, config: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): StorageDriver {
    switch (driver) {
      case 's3':
        return new S3Driver({
          endpoint: type === 'google_cloud' ? GOOGLE_ENDPOINT : config.endpoint || undefined,
          region: type === 'google_cloud' ? 'auto' : config.region!,
          bucket: config.bucket!,
          pathStyle: config.pathStyle === 'true',
          accessKeyId: secrets.accessKeyId!,
          secretAccessKey: secrets.secretAccessKey!,
        });
      case 'azure_blob':
        return new AzureBlobDriver({ accountName: config.accountName!, accountKey: secrets.accountKey!, container: config.container!, endpoint: config.endpoint || undefined });
      case 'mega':
        return new MegaDriver({ email: secrets.email!, password: secrets.password!, folder: config.folder! });
      default:
        throw new StorageUnavailable(`No driver for ${type}`);
    }
  }
}
