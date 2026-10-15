/**
 * Telegram Bot API response shapes, narrowed to what this host uses.
 *
 * Every `ok: false` body carries a `description` naming the bot token or the
 * method that failed, so `TelegramError.description` is logged and never
 * returned to a client.
 */
export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  video?: TelegramDocument;
  audio?: TelegramDocument;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  /**
   * Optional in practice: Telegram documents it as always present, but `getFile`
   * answers `ok: true` with no path for a file too old for the bot, and that
   * arrives here as a missing field rather than an error. Optional so the client
   * has to handle it — a required field would let the type system erase the check
   * that stops a fetch of `.../bot<token>/undefined`.
   */
  file_path?: string;
  file_size?: number;
}
