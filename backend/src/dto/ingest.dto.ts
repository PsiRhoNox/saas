export interface IngestUploadDto {
  tenantId: string;
  fileName: string;
  content: string;
}

export interface SftpConfigDto {
  tenantId: string;
  host: string;
  user: string;
  authType: 'password' | 'key';
  password?: string;
  privateKey?: string;
  path: string;
  schedule: string;
  timezone: string;
}
