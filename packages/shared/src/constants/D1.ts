/**
The single definition of the D1 binding name. Templates, env types and DAOs all read it.
*/
export const D1_BINDING = 'ImageHostDB';

/**
The public share-link prefix. Kept here so the worker and the SPA cannot disagree on it.
*/
export const SHARE_PATH_PREFIX = '/i';

/**
The Cloudflare Access entry point. Navigating here is what triggers the login flow.
*/
export const ACCESS_ENTRY_PATH = '/user/';
