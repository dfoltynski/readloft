/**
 * Import an ES module from a URL at runtime, invisible to Vite.
 *
 * foliate-js lives in public/ and is served as raw ES modules. A plain
 * `import(url)` gets rewritten by Vite's dev server (it appends `?import`),
 * which then refuses to serve files from public/. Hiding the call inside a
 * Function keeps both the dev server and the bundler out of it.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;

export function runtimeImport<T = unknown>(path: string): Promise<T> {
  return nativeImport(new URL(path, window.location.origin).href) as Promise<T>;
}
