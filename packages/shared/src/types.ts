export type ImageStatus = 'active' | 'blocked' | 'deleted';

export interface ImageRecord {
  id: number;
  slug: string;
  ownerEmail: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  deletedAt: string | null;
  blocked: boolean;
  viewCount: number;
}

export interface CreateImageInput {
  slug?: string;
  ownerEmail: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface UploadResult {
  slug: string;
  fileId: string;
  fileName: string;
  url: string;
  compatUrl: string;
}

export interface Identity {
  email: string;
}