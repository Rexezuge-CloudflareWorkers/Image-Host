import type { ImageView, PagedImages } from '../types';
import { apiGet, apiSend, apiUpload } from '../lib/api';
import { UploadConstraints } from '@image-host/shared/schema';

export function listImages(page = 0, query?: string): Promise<PagedImages & { success: true }> {
  return apiGet<PagedImages & { success: true }>('/user/images', { page, q: query });
}

export function uploadImage(file: File): Promise<{ success: true; image: ImageView }> {
  const formData = new FormData();
  // The field name is shared with the server, from the same module, so the two
  // cannot drift into a 400 that only reproduces in the browser.
  formData.append(UploadConstraints.fieldName, file);
  return apiUpload<{ success: true; image: ImageView }>('/user/images', formData);
}

export function deleteImage(id: number): Promise<{ success: true }> {
  return apiSend<{ success: true }>(`/user/images/${id}`, 'DELETE');
}

export function setImageBlocked(id: number, blocked: boolean): Promise<{ success: true }> {
  return apiSend<{ success: true }>(`/user/images/${id}/block`, 'PUT', { blocked });
}
